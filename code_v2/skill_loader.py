"""
Skill loader (P1 · C1/C2) — Agent Skills open-standard loader.

Skills live in code_v2/skills/<name>/SKILL.md with YAML frontmatter
(name / description / label) followed by markdown instructions.

Progressive disclosure:
  - list_skills()  → metadata only (cheap, for /api/skills and chips UI)
  - load_skill()   → full instruction body (injected into the system prompt
                     when the skill is activated; P2 will route selection
                     through the decision layer instead of explicit chips)

Caching: directory mtimes are tracked; edits to any SKILL.md hot-reload
on the next call without a server restart.
"""
import os
import re
import time
from typing import Dict, List, Optional

SKILLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skills")

_FM_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", re.DOTALL)
_NAME_RE = re.compile(r"^name:\s*(.+)$", re.M)
_DESC_RE = re.compile(r"^description:\s*(.+)$", re.M)
_LABEL_RE = re.compile(r"^label:\s*(.+)$", re.M)

_cache: Dict[str, dict] = {}
_cache_dir_mtime: Optional[float] = None
_cache_file_mtimes: Dict[str, float] = {}


def _parse_frontmatter(text: str) -> dict:
    m = _FM_RE.match(text)
    if not m:
        return {}
    fm, body = m.group(1), m.group(2)
    out = {"body": body.strip()}
    for key, rx in (("name", _NAME_RE), ("description", _DESC_RE), ("label", _LABEL_RE)):
        mm = rx.search(fm)
        if mm:
            out[key] = mm.group(1).strip().strip('"').strip("'")
    return out


def _scan(force: bool = False) -> Dict[str, dict]:
    """(Re)scan the skills directory when anything changed."""
    global _cache, _cache_dir_mtime, _cache_file_mtimes
    try:
        dir_mtime = os.path.getmtime(SKILLS_DIR)
    except OSError:
        _cache, _cache_file_mtimes = {}, {}
        return _cache

    file_mtimes = {}
    try:
        for entry in os.listdir(SKILLS_DIR):
            path = os.path.join(SKILLS_DIR, entry, "SKILL.md")
            if os.path.isfile(path):
                try:
                    file_mtimes[entry] = os.path.getmtime(path)
                except OSError:
                    pass
    except OSError:
        file_mtimes = {}

    if (not force and dir_mtime == _cache_dir_mtime
            and file_mtimes == _cache_file_mtimes):
        return _cache

    fresh: Dict[str, dict] = {}
    for name, mtime in file_mtimes.items():
        try:
            with open(os.path.join(SKILLS_DIR, name, "SKILL.md"), encoding="utf-8") as f:
                parsed = _parse_frontmatter(f.read())
        except OSError:
            continue
        if not parsed.get("name"):
            continue  # malformed frontmatter — skip, never 500 the endpoint
        fresh[parsed["name"]] = {
            "name": parsed["name"],
            "description": parsed.get("description", ""),
            "label": parsed.get("label", parsed["name"]),
            "body": parsed.get("body", ""),
        }
    _cache = fresh
    _cache_dir_mtime = dir_mtime
    _cache_file_mtimes = file_mtimes
    return _cache


def list_skills() -> List[dict]:
    """Metadata for /api/skills and the chips UI (progressive disclosure L1)."""
    skills = _scan()
    return [
        {"name": s["name"], "label": s["label"], "description": s["description"]}
        for s in skills.values()
    ]


def load_skill(name: str) -> Optional[str]:
    """Full instruction body for system-prompt injection (L2/L3). None if absent."""
    if not name:
        return None
    return _scan().get(name, {}).get("body")


def skill_label(name: str) -> str:
    return _scan().get(name, {}).get("label", name)


# Simple smoke check when run directly:  python skill_loader.py
if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    for s in list_skills():
        print(f"{s['name']:16s} {s['label']}  — {s['description'][:50]}")
    body = load_skill("socratic-tutor")
    print("\nsocratic-tutor body chars:", len(body or ""))
