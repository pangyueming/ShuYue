"""
CogniBridge Harness V2/V3 Integration Bridge

This module provides a unified interface for calling either:
- V2 (stable): harness_uk/harness_uk_math.py
- V3 (improved): harness_improve/harness_v3.py

Usage in server.py:
    from harness_improve.integration.server_bridge import solve_question

    # This will use V2 by default
    result = solve_question(question_text="...", api_key="...")

    # To force V3 (when available):
    result = solve_question(question_text="...", api_key="...", use_v3=True)

Configuration:
    Set environment variable HARNESS_VERSION=v3 to default to V3.
"""

import os
import sys
from typing import Optional, Dict, Any

# ---------------------------------------------------------------------------
# Path setup: ensure both harness_uk and harness_improve are importable
# ---------------------------------------------------------------------------

# V2 path (stable)
_HARNESS_V2_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "harness_uk"
)
if _HARNESS_V2_DIR not in sys.path:
    sys.path.insert(0, _HARNESS_V2_DIR)

# V3 path (improvement)
_HARNESS_V3_DIR = os.path.join(
    os.path.dirname(__file__), ".."
)
if _HARNESS_V3_DIR not in sys.path:
    sys.path.insert(0, _HARNESS_V3_DIR)

# ---------------------------------------------------------------------------
# Import V2 (always available)
# ---------------------------------------------------------------------------

try:
    from harness_uk_math import solve_question as _solve_question_v2
    _V2_AVAILABLE = True
except ImportError as e:
    _V2_AVAILABLE = False
    _V2_IMPORT_ERROR = str(e)

# ---------------------------------------------------------------------------
# Import V3
# ---------------------------------------------------------------------------

_V3_AVAILABLE = False
_solve_question_v3 = None
_V3_IMPORT_ERROR = "V3 not yet implemented"

def _try_import_v3():
    """Attempt to import V3 solve function. Called lazily."""
    global _V3_AVAILABLE, _solve_question_v3, _V3_IMPORT_ERROR

    if _V3_AVAILABLE:
        return True

    try:
        from harness_v3 import solve_question
        _solve_question_v3 = solve_question
        _V3_AVAILABLE = True
        _V3_IMPORT_ERROR = ""
        return True
    except ImportError as e:
        _V3_IMPORT_ERROR = str(e)
        return False

# ---------------------------------------------------------------------------
# Bridge function
# ---------------------------------------------------------------------------

def solve_question(
    question_text: str,
    options: Optional[list] = None,
    api_key: Optional[str] = None,
    model: str = "qwen3.6-35b-a3b",
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1",
    student_level: str = "first_year",
    use_v3: Optional[bool] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Unified solve function that routes to V2 or V3.

    Args:
        question_text: The math question
        options: MCQ options (if any)
        api_key: DashScope API key
        model: Model name
        base_url: API endpoint
        student_level: "first_year" | "second_year" | "postgraduate"
        use_v3: If True, force V3; if False, force V2; if None, use env default
        **kwargs: Additional arguments passed to underlying solver

    Returns:
        Dictionary with keys:
            - answer: final answer string
            - solution: full solution text
            - topic: identified topic
            - lane: "A" or "B"
            - confidence: vote confidence (0-1)
            - verified: whether verifier was used
            - usage: token usage dict
            - version: "v2" or "v3" (indicates which harness was used)
    """

    # Determine version
    if use_v3 is None:
        use_v3 = os.getenv("HARNESS_VERSION", "v2").lower() == "v3"

    # Route to V3
    if use_v3:
        if _try_import_v3():
            result = _solve_question_v3(
                question_text=question_text,
                options=options,
                api_key=api_key,
                model=model,
                base_url=base_url,
                student_level=student_level,
                **kwargs
            )
            result["version"] = "v3"
            return result
        else:
            # V3 requested but not available: fall back to V2 with warning
            import warnings
            warnings.warn(
                f"V3 requested but not available ({_V3_IMPORT_ERROR}). "
                f"Falling back to V2.",
                RuntimeWarning
            )
            # Fall through to V2

    # Route to V2 (default)
    if not _V2_AVAILABLE:
        raise RuntimeError(
            f"Neither V2 nor V3 harness is available. "
            f"V2 error: {_V2_IMPORT_ERROR}. "
            f"V3 error: {_V3_IMPORT_ERROR}"
        )

    result = _solve_question_v2(
        question_text=question_text,
        options=options,
        api_key=api_key,
        model=model,
        base_url=base_url,
        student_level=student_level,
        **kwargs
    )
    result["version"] = "v2"
    return result


# ---------------------------------------------------------------------------
# Diagnostic / introspection helpers
# ---------------------------------------------------------------------------

def get_harness_status() -> Dict[str, Any]:
    """Return the availability status of V2 and V3 harnesses."""
    _try_import_v3()  # Ensure V3 import is attempted

    return {
        "v2": {
            "available": _V2_AVAILABLE,
            "error": _V2_IMPORT_ERROR if not _V2_AVAILABLE else None,
            "path": _HARNESS_V2_DIR,
        },
        "v3": {
            "available": _V3_AVAILABLE,
            "error": _V3_IMPORT_ERROR if not _V3_AVAILABLE else None,
            "path": _HARNESS_V3_DIR,
        },
        "default_version": os.getenv("HARNESS_VERSION", "v2"),
    }


def set_default_version(version: str):
    """Set the default harness version via environment variable."""
    os.environ["HARNESS_VERSION"] = version


__all__ = [
    "solve_question",
    "get_harness_status",
    "set_default_version",
]
