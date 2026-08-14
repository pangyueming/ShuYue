"""
Unified API Client for Harness V3
Wraps OpenAI-compatible API calls with retry, streaming, and timeout support.
"""
import json
import time
from typing import Optional, Tuple, Dict, Any
import requests


class APIClient:
    """Reusable API client with automatic retry and usage tracking."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: str = "qwen3.6-35b-a3b",
        timeout: int = 180,
        retries: int = 3,
        retry_delay: float = 2.0,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.retries = retries
        self.retry_delay = retry_delay
        self.session = requests.Session()

    def chat_completion(
        self,
        messages: list,
        temperature: float = 0.0,
        max_tokens: int = 4096,
        stream: bool = False,
        enable_thinking: bool = True,
        request_deadline: Optional[float] = None,
    ) -> Tuple[str, Dict[str, Any], Optional[str]]:
        """
        Call chat/completions with retry logic.

        Returns:
            (response_text, usage_dict, error_or_None)
        """
        url = self.base_url + "/chat/completions"
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
            "enable_thinking": enable_thinking,
        }
        if stream:
            payload["stream_options"] = {"include_usage": True}

        last_error = None
        for attempt in range(1, self.retries + 1):
            try:
                if stream:
                    text, usage = self._call_stream(
                        url, payload, request_deadline
                    )
                else:
                    text, usage = self._call_sync(url, payload)
                return text, usage, None

            except (requests.RequestException, KeyError, ValueError) as exc:
                body = ""
                resp_obj = getattr(exc, "response", None)
                if resp_obj is not None:
                    body = (resp_obj.text or "")[:2000]
                last_error = f"{type(exc).__name__}: {exc}" + (
                    f"; response={body}" if body else ""
                )
                if attempt < self.retries:
                    time.sleep(self.retry_delay * attempt)

        return "", {}, last_error

    def _call_sync(self, url: str, payload: dict) -> Tuple[str, dict]:
        resp = self.session.post(
            url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        body = resp.json()
        text = body["choices"][0]["message"]["content"]
        usage = body.get("usage", {})
        return text, usage

    def _call_stream(
        self, url: str, payload: dict, deadline: Optional[float]
    ) -> Tuple[str, dict]:
        resp = self.session.post(
            url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            stream=True,
            timeout=self.timeout,
        )
        resp.raise_for_status()

        parts, usage = [], {}
        started = time.monotonic()

        for raw_line in resp.iter_lines(decode_unicode=True):
            if deadline and time.monotonic() - started > deadline:
                resp.close()
                raise requests.Timeout(f"Stream exceeded {deadline}s deadline")
            if not raw_line or not raw_line.startswith("data:"):
                continue
            data = raw_line[5:].strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            if event.get("usage"):
                usage = event["usage"]
            choices = event.get("choices") or []
            if choices:
                delta = choices[0].get("delta", {}).get("content")
                if delta:
                    parts.append(delta)

        return "".join(parts), usage

    def close(self):
        self.session.close()
