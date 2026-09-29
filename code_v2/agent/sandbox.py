# -*- coding: utf-8 -*-
"""P10 (D11): Python sandbox — isolated execution for agent-run calculations.

Design (research-informed, v2.7 §P10 + e2b/Anthropic mechanisms):
  Layer 1  STATIC (AST)   — import whitelist, dangerous-call/name blacklist,
                            2KB size cap. Ephemeral template philosophy: the
                            environment is FIXED UPFRONT (whitelist only).
  Layer 2  RUNTIME        — one fresh subprocess per run (stateless = zero
                            cross-user contamination), `python -I` isolated
                            mode, EMPTY env (API keys can never leak into the
                            sandbox), temp cwd.
  Layer 3  RESOURCE       — 5s hard timeout, output truncation (2000 chars),
                            concurrency semaphore (≤2) protects the server.

Contract: run(code) -> {ok, stdout, stderr, error_type, ms, truncated}
  error_type: none | forbidden | size | syntax | timeout | exception
"""
import ast
import subprocess
import sys
import tempfile
import threading
import time

# ---- environment template (fixed upfront — E2B-style) ----------------------
ALLOWED_IMPORTS = {"math", "cmath", "fractions", "statistics", "itertools",
                   "sympy", "numpy", "random"}

FORBIDDEN_CALLS = {"open", "eval", "exec", "compile", "__import__", "input",
                   "breakpoint", "exit", "quit", "globals", "locals", "vars",
                   "vars", "delattr", "setattr"}
FORBIDDEN_NAMES = {"__builtins__", "builtins", "__import__", "globals",
                   "locals", "vars", "breakpoint", "license", "help"}
FORBIDDEN_ATTR_ROOTS = {"os", "sys", "subprocess", "socket", "shutil",
                        "pathlib", "ctypes", "multiprocessing", "threading",
                        "pickle", "builtins", "__builtins__", "importlib"}

MAX_CODE_CHARS = 2048
TIMEOUT_S = 5
MAX_OUTPUT = 2000
MAX_CONCURRENT = 2

_sem = threading.BoundedSemaphore(MAX_CONCURRENT)

# minimal Windows-safe env — NOTHING from the server env (no DASHSCOPE_API_KEY,
# no SECRET_KEY, no SMTP creds) can ever reach sandboxed code.
import os as _os
_MIN_ENV = {}
if _os.name == "nt":
    _MIN_ENV["SYSTEMROOT"] = _os.environ.get("SYSTEMROOT", "C:\\Windows")


class _Forbidden(Exception):
    pass


def _static_check(code: str):
    """Layer 1: AST-level gate. Raises _Forbidden with a reason."""
    if len(code) > MAX_CODE_CHARS:
        raise _Forbidden(f"代码过长（>{MAX_CODE_CHARS} 字符）")
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise SyntaxError(str(e))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                root = (a.name or "").split(".")[0]
                if root not in ALLOWED_IMPORTS:
                    raise _Forbidden(f"禁止导入 {a.name}")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0] if node.module else ""
            if root not in ALLOWED_IMPORTS:
                raise _Forbidden(f"禁止从 {node.module} 导入")
        elif isinstance(node, ast.Name):
            if node.id in FORBIDDEN_NAMES:
                raise _Forbidden(f"禁止访问 {node.id}")
        elif isinstance(node, ast.Attribute):
            # attribute roots: a bare name like os.environ — the Name node
            # handles bare ids; here catch chains off forbidden roots
            base = node.value
            if isinstance(base, ast.Name) and base.id in FORBIDDEN_ATTR_ROOTS:
                raise _Forbidden(f"禁止访问 {base.id}.*")
        elif isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name) and f.id in FORBIDDEN_CALLS:
                raise _Forbidden(f"禁止调用 {f.id}()")
            if isinstance(f, ast.Attribute) and f.attr in FORBIDDEN_CALLS:
                raise _Forbidden(f"禁止调用 .{f.attr}()")


def run(code: str) -> dict:
    """Execute `code` inside the sandbox. Never raises."""
    t0 = time.time()
    try:
        _static_check(code)
    except _Forbidden as e:
        return {"ok": False, "stdout": "", "stderr": f"FORBIDDEN: {e}",
                "error_type": "forbidden", "ms": 0, "truncated": False}
    except SyntaxError as e:
        return {"ok": False, "stdout": "", "stderr": f"SyntaxError: {e}",
                "error_type": "syntax", "ms": 0, "truncated": False}

    with _sem:
        try:
            proc = subprocess.run(
                [sys.executable, "-I", "-c", code],
                capture_output=True, text=True, timeout=TIMEOUT_S,
                cwd=tempfile.gettempdir(), env=_MIN_ENV)
            ms = int((time.time() - t0) * 1000)
            out = proc.stdout or ""
            err = proc.stderr or ""
            truncated = len(out) > MAX_OUTPUT
            ok = proc.returncode == 0
            return {"ok": ok,
                    "stdout": out[:MAX_OUTPUT],
                    "stderr": err[:500],
                    "error_type": "none" if ok else "exception",
                    "ms": ms, "truncated": truncated}
        except subprocess.TimeoutExpired:
            return {"ok": False, "stdout": "", "stderr": f"执行超时（>{TIMEOUT_S}s）",
                    "error_type": "timeout", "ms": int((time.time() - t0) * 1000),
                    "truncated": False}
        except Exception as e:
            return {"ok": False, "stdout": "", "stderr": f"沙盒错误: {str(e)[:200]}",
                    "error_type": "exception", "ms": int((time.time() - t0) * 1000),
                    "truncated": False}
