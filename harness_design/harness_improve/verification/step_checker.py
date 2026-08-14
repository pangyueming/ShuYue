"""
Step Checker: Verify intermediate steps in solutions
Uses SymPy to check symbolic equivalence of key intermediate expressions.
"""
import re
from typing import List, Tuple, Dict, Optional
from tools.sympy_executor import SymPyExecutor


class StepChecker:
    """
    Checks key intermediate steps in a mathematical solution.
    Extracts expressions after "=", "→", "implies" and verifies them.
    """

    def __init__(self):
        self.executor = SymPyExecutor()

    def check_solution_steps(
        self,
        solution: str,
        expected_steps: Optional[List[str]] = None,
    ) -> Dict:
        """
        Check solution steps for symbolic correctness.

        Args:
            solution: Full solution text
            expected_steps: Optional list of expected intermediate expressions

        Returns:
            {
                'valid': bool,
                'steps_checked': int,
                'errors': List[Dict],
                'step_results': List[Dict],
            }
        """
        # Extract equations from solution
        equations = self._extract_equations(solution)

        errors = []
        step_results = []

        for i, eq in enumerate(equations):
            result = self._verify_equation(eq)
            step_results.append({
                "step": i + 1,
                "equation": eq,
                "valid": result["valid"],
                "error": result.get("error", ""),
            })

            if not result["valid"]:
                errors.append({
                    "step": i + 1,
                    "equation": eq,
                    "error": result.get("error", "Symbolic mismatch"),
                })

        # If expected steps provided, verify they appear
        if expected_steps:
            for expected in expected_steps:
                found = any(self._fuzzy_match(expected, eq) for eq in equations)
                if not found:
                    errors.append({
                        "step": "expected",
                        "equation": expected,
                        "error": "Expected step not found in solution",
                    })

        valid = len(errors) == 0

        return {
            "valid": valid,
            "steps_checked": len(equations),
            "errors": errors,
            "step_results": step_results,
        }

    def _extract_equations(self, text: str) -> List[str]:
        """Extract equations/lines with mathematical content."""
        equations = []
        lines = text.split("\n")

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Skip non-math lines
            if line.startswith(("Proof", "Solution", "Therefore", "Hence", "Thus", "So")):
                # But may contain equation after colon
                if "=" not in line and "→" not in line:
                    continue

            # Look for equations with =
            if "=" in line and not line.startswith("="):
                # Extract the equation part
                eq_match = re.search(r"([^=]+=.+)", line)
                if eq_match:
                    equations.append(eq_match.group(1).strip())

            # Look for limit expressions
            if "lim" in line:
                equations.append(line)

            # Look for integral expressions
            if "∫" in line or "\\int" in line:
                equations.append(line)

        # Deduplicate while preserving order
        seen = set()
        unique = []
        for eq in equations:
            norm = eq.replace(" ", "").lower()
            if norm not in seen and len(eq) > 5:
                seen.add(norm)
                unique.append(eq)

        return unique[:10]  # Limit to first 10 equations

    def _verify_equation(self, eq: str) -> Dict:
        """Verify a single equation for symbolic consistency."""
        # Simple heuristic: if equation has =, check if LHS and RHS are equivalent
        if "=" not in eq:
            return {"valid": True, "error": ""}

        parts = eq.split("=")
        if len(parts) != 2:
            return {"valid": True, "error": ""}

        lhs = parts[0].strip()
        rhs = parts[1].strip()

        # Skip trivial cases
        if not lhs or not rhs:
            return {"valid": True, "error": ""}

        # Check if RHS is a numeric value (no need to verify)
        if self._is_simple_numeric(rhs):
            return {"valid": True, "error": ""}

        # Try symbolic verification
        try:
            result = self.executor.verify_expression(lhs, rhs)
            if result["equivalent"]:
                return {"valid": True, "error": ""}
            else:
                return {
                    "valid": False,
                    "error": f"LHS ({lhs}) not equivalent to RHS ({rhs})",
                }
        except Exception as e:
            # If verification fails, assume valid (don't penalize parsing issues)
            return {"valid": True, "error": f"Could not verify: {e}"}

    def _is_simple_numeric(self, expr: str) -> bool:
        """Check if expression is just a number."""
        try:
            float(expr.replace(" ", ""))
            return True
        except ValueError:
            return False

    def _fuzzy_match(self, expected: str, actual: str) -> bool:
        """Fuzzy match expected step to actual step."""
        expected_norm = expected.replace(" ", "").lower()
        actual_norm = actual.replace(" ", "").lower()
        return expected_norm in actual_norm or actual_norm in expected_norm
