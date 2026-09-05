"""MinerU cloud API client (transport layer).

Pipeline: split PDF (<=190 pages/part, cloud limit is 200) -> request upload
URLs -> PUT part -> poll batch -> download zip -> extract content_list blocks.
Callers handle page_idx offsetting when merging parts.
"""
from __future__ import annotations

import json
import re
import time
import zipfile
from io import BytesIO
from pathlib import Path

import requests
from pypdf import PdfReader, PdfWriter

BASE_URL = "https://mineru.net/api/v4"
MAX_PART_PAGES = 190
POLL_INTERVAL = 6
SKIP_TYPES = {"header", "footer", "page_number", "aside_text", "page_footnote"}


class MineruAuthError(RuntimeError):
    """The MinerU API rejected the user's token (401/403)."""


def validate_token(token: str) -> bool:
    """Live probe: query a nonexistent batch id. 401/403 = bad key; anything
    else (404, 200, validation error) = key accepted. Network hiccups are
    treated as valid so saving is never blocked by our own connectivity."""
    try:
        resp = requests.get(
            f"{BASE_URL}/extract-results/batch/__keycheck__",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        return resp.status_code not in (401, 403)
    except Exception:  # noqa: BLE001
        return True


def count_pages(pdf_path: Path) -> int:
    return len(PdfReader(str(pdf_path)).pages)


def split_pdf(pdf: Path, parts_dir: Path, max_pages: int = MAX_PART_PAGES) -> list[tuple[Path, int]]:
    """Split into parts of <=max_pages; returns [(part_path, zero_based_start_page)]."""
    reader = PdfReader(str(pdf))
    total = len(reader.pages)
    parts_dir.mkdir(parents=True, exist_ok=True)
    jobs: list[tuple[Path, int]] = []
    part_idx, start = 0, 0
    while start < total:
        end = min(start + max_pages, total)
        part_path = parts_dir / f"part{part_idx:02d}_p{start + 1}-{end}.pdf"
        if not part_path.exists():
            writer = PdfWriter()
            for i in range(start, end):
                writer.add_page(reader.pages[i])
            with open(part_path, "wb") as handle:
                writer.write(handle)
        jobs.append((part_path, start))
        part_idx += 1
        start = end
    return jobs


def _api_post(url: str, token: str, payload: dict) -> dict:
    resp = requests.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=60,
    )
    if resp.status_code in (401, 403):
        raise MineruAuthError(f"MinerU API key was rejected (HTTP {resp.status_code})")
    resp.raise_for_status()
    return resp.json()


def _api_get(url: str, token: str) -> dict:
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    if resp.status_code in (401, 403):
        raise MineruAuthError(f"MinerU API key was rejected (HTTP {resp.status_code})")
    resp.raise_for_status()
    return resp.json()


def submit_part(part_path: Path, start_page0: int, token: str, language: str, timeout: int) -> list:
    """Submit one part PDF; returns its content_list blocks (page_idx part-relative)."""
    payload = {
        "enable_formula": True,
        "enable_table": True,
        "language": language,
        "enable_ocr": True,
        "files": [{"name": part_path.name, "is_ocr": True, "data_id": part_path.stem}],
    }
    submission = _api_post(f"{BASE_URL}/file-urls/batch", token, payload)
    if submission.get("code") not in (0, "0"):
        raise RuntimeError(f"submission failed: {json.dumps(submission, ensure_ascii=False)[:500]}")
    data = submission.get("data") or {}
    batch_id = data.get("batch_id") or data.get("batchId")
    urls = data.get("file_urls") or data.get("fileUrls") or data.get("upload_urls") or []
    if not batch_id or not urls:
        raise RuntimeError(f"unexpected submission response: {json.dumps(submission, ensure_ascii=False)[:500]}")

    up = requests.put(urls[0], data=part_path.read_bytes(), timeout=600)
    if up.status_code not in (200, 201):
        raise RuntimeError(f"upload failed: HTTP {up.status_code}: {up.text[:200]}")

    started = time.monotonic()
    while time.monotonic() - started < timeout:
        status = _api_get(f"{BASE_URL}/extract-results/batch/{batch_id}", token)
        results = (status.get("data") or {}).get("extract_result") or []
        item = results[0] if results else {}
        state = item.get("state", "")
        if state == "done":
            zip_url = (
                item.get("full_zip_url")
                or item.get("zip_url")
                or item.get("result_url")
                or (item.get("result") or {}).get("full_zip_url")
            )
            break
        if state == "failed":
            raise RuntimeError(
                f"parse failed: {item.get('err_msg') or json.dumps(item, ensure_ascii=False)[:300]}"
            )
        time.sleep(POLL_INTERVAL)
    else:
        raise RuntimeError(f"timed out after {timeout}s (batch_id={batch_id})")

    zip_resp = requests.get(zip_url, timeout=300)
    zip_resp.raise_for_status()
    with zipfile.ZipFile(BytesIO(zip_resp.content)) as zf:
        for name in zf.namelist():
            lowered = name.lower()
            if lowered.endswith("content_list.json") and not lowered.endswith("_v2.json"):
                return json.loads(zf.read(name).decode("utf-8"))
    raise RuntimeError("content_list.json not found in result zip")


def detect_needs_ocr(pdf_path: Path, threshold: int = 30) -> bool:
    """Sample 5 pages; avg extractable text below threshold => scanned/image PDF."""
    reader = PdfReader(str(pdf_path))
    n = len(reader.pages)
    if n == 0:
        return False
    idxs = sorted({0, n // 4, n // 2, (3 * n) // 4, n - 1})
    total = 0
    for i in idxs:
        try:
            total += len((reader.pages[i].extract_text() or "").strip())
        except Exception:  # noqa: BLE001
            pass
    return (total / len(idxs)) < threshold


def block_to_text(block: dict) -> str:
    """Flatten one content_list block to readable text (headers/footers dropped)."""
    btype = block.get("type", "text")
    if btype in SKIP_TYPES:
        return ""
    if btype in ("text", "title"):
        text = (block.get("text") or "").strip()
        level = block.get("text_level") or 0
        if isinstance(level, int) and 1 <= level <= 4 and text:
            text = "#" * level + " " + text
        return text
    if btype == "equation":
        return (block.get("text") or "").strip()
    if btype == "table":
        parts = []
        for caption in block.get("table_caption") or []:
            parts.append(str(caption).strip())
        plain = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", block.get("table_body") or "")).strip()
        if plain:
            parts.append("[table] " + plain)
        for footnote in block.get("table_footnote") or []:
            parts.append(str(footnote).strip())
        return "\n".join(p for p in parts if p)
    if btype in ("image", "chart"):
        captions = block.get("image_caption") or []
        parts = [str(c).strip() for c in captions if str(c).strip()]
        return "\n".join(parts) if parts else ""
    if btype == "code":
        return (block.get("code_body") or block.get("text") or "").strip()
    return (block.get("text") or "").strip()


def normalize_pages(content_list: list, total_pages: int) -> list[dict]:
    """Group blocks by page -> [{page (1-based), page_idx, text}] for chunking."""
    pages: dict[int, list[str]] = {}
    for block in content_list:
        text = block_to_text(block)
        if text:
            pages.setdefault(block.get("page_idx", 0), []).append(text)
    return [
        {"page": idx + 1, "page_idx": idx, "text": "\n\n".join(pages[idx])}
        for idx in sorted(pages)
    ]
