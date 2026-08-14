"""
Answer Verifier: Symbolic and numeric equivalence checking
"""
import re
from typing import Tuple, Optional
from tools.notation_mapper import NotationMapper
from tools.sympy_executor import SymPyExecutor


class AnswerVerifier:
    """Verifies if predicted answer matches ground truth."""

    def __init__(self):
        self.executor = SymPyExecutor()

    def verify(
        self,
        pred: str,
        gold: str,
        topic: str = "",
        tolerance: float = 1e-6,
    ) -> Tuple[bool, str]:
        """
        Check if pred and gold are equivalent.

        Returns:
            (is_correct, match_type)
        """
        if not pred or not gold:
            return False, "empty"

        # 1. Normalized exact match
        np = NotationMapper.normalize_for_comparison(pred, topic)
        ng = NotationMapper.normalize_for_comparison(gold, topic)

        if np == ng:
            return True, "exact"

        # 2. LaTeX stripped match
        np_latex = self._strip_latex(np)
        ng_latex = self._strip_latex(ng)
        if np_latex == ng_latex:
            return True, "latex_normalized"

        # 3. Symbolic equivalence via SymPy
        sym_result = self._check_symbolic(pred, gold)
        if sym_result:
            return True, "symbolic"

        # 4. Numeric tolerance
        num_result = self._check_numeric(pred, gold, tolerance)
        if num_result:
            return True, "numeric"

        # 5. MCQ single letter
        if len(np) == 1 and len(ng) == 1 and np.isalpha() and ng.isalpha():
            return np == ng, "mcq" if np == ng else "no_match"

        return False, "no_match"

    def _strip_latex(self, text: str) -> str:
        """Remove common LaTeX commands for comparison."""
        s = text
        s = re.sub(r"\\frac\{(.*?)\}\{(.*?)\}", r"(\1)/(\2)", s)
        s = re.sub(r"\\sqrt\{(.*?)\}", r"sqrt(\1)", s)
        s = re.sub(r"\\left", "", s)
        s = re.sub(r"\\right", "", s)
        s = re.sub(r"\\\{", "(", s)
        s = re.sub(r"\\\}", ")", s)
        s = s.replace("\\", "")
        return s.strip()

    def _check_symbolic(self, pred: str, gold: str) -> bool:
        """Use SymPy to check symbolic equivalence."""
        try:
            # Try direct SymPy comparison
            diff_expr = f"simplify(({pred}) - ({gold}))"
            result = self.executor.execute(diff_expr)

            if result["success"]:
                res_str = result["result"].replace(" ", "")
                if res_str == "0":
                    return True

            # Try ratio = 1
            ratio_expr = f"simplify(({pred}) / ({gold}))"
            result = self.executor.execute(ratio_expr)
            if result["success"]:
                res_str = result["result"].replace(" ", "")
                if res_str == "1":
                    return True

        except Exception:
            pass

        return False

    def _check_numeric(self, pred: str, gold: str, tolerance: float) -> bool:
        """Check numeric equality within tolerance."""
        try:
            # Evaluate both as floats
            pred_val = float(pred)
            gold_val = float(gold)
            return abs(pred_val - gold_val) < tolerance
        except (ValueError, TypeError):
            pass

        # Try SymPy numeric evaluation
        try:
            pred_expr = f"float(N({pred}))"
            gold_expr = f"float(N({gold}))"

            r1 = self.executor.execute(pred_expr)
            r2 = self.executor.execute(gold_expr)

            if r1["success"] and r2["success"]:
                v1 = float(r1["result"])
                v2 = float(r2["result"])
                return abs(v1 - v2) < tolerance
        except Exception:
            pass

        return False
