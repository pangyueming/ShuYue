"""
CogniBridge Harness V3 — Improved Math Solving Engine

This package provides an enhanced harness for solving UK university
mathematics problems using Qwen3.6-35B-A3B with:
- Smart routing (Lane A/B)
- Tool-integrated reasoning (ToRA mode)
- Proof structure verification
- Step-by-step checking
- Notation normalization

Main entry point:
    from harness_improve import solve_question
    result = solve_question(question_text="...", api_key="...")
"""

from harness_v3 import solve_question

__version__ = "3.0.0"
__all__ = ["solve_question"]
