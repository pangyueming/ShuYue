"""
Few-shot Examples for UK Mathematics
"""

FEW_SHOT_MCQ = (
    "Example (Multiple Choice):\n"
    "Question: Evaluate lim(x→0) sin(x)/x\n"
    "  A. 0    B. 1    C. Does not exist    D. ∞\n"
    "Solution: This is a fundamental limit. As x→0, sin(x)≈x, so sin(x)/x≈x/x=1.\n"
    "<answer>B</answer>\n\n"
)

FEW_SHOT_SHORT = (
    "Example (Short Answer):\n"
    "Question: Find the derivative of f(x) = x³·e^x\n"
    "Solution: Using the product rule: f'(x) = 3x²·e^x + x³·e^x = x²·e^x(3+x)\n"
    "<answer>x^2 * e^x * (3 + x)</answer>\n\n"
)

FEW_SHOT_PROOF = (
    "Example (Proof by Induction):\n"
    "Question: Prove that 1 + 2 + ... + n = n(n+1)/2 for all positive integers n.\n"
    "Solution:\n"
    "Base case (n=1): LHS = 1, RHS = 1(2)/2 = 1. ✓\n"
    "Inductive hypothesis: Assume true for n=k, i.e., 1+2+...+k = k(k+1)/2.\n"
    "Inductive step: For n=k+1:\n"
    "  LHS = 1+2+...+k+(k+1) = k(k+1)/2 + (k+1) = (k+1)(k/2 + 1) = (k+1)(k+2)/2 = RHS.\n"
    "Conclusion: By the principle of mathematical induction, the formula holds for all n≥1.\n"
    "<answer>Proof by induction: base case n=1 verified; inductive step shows P(k)⇒P(k+1).</answer>\n\n"
)

FEW_SHOT_EPSILON_DELTA = (
    "Example (ε-δ Proof):\n"
    "Question: Using the ε-δ definition, prove that lim(x→2) (3x+1) = 7.\n"
    "Solution:\n"
    "Let ε > 0 be given. We need to find δ > 0 such that |3x+1 - 7| < ε whenever 0 < |x-2| < δ.\n"
    "|3x+1 - 7| = |3x - 6| = 3|x - 2|.\n"
    "We want 3|x - 2| < ε, so |x - 2| < ε/3.\n"
    "Choose δ = ε/3. Then 0 < |x-2| < δ implies |3x+1 - 7| = 3|x-2| < 3(ε/3) = ε.\n"
    "Therefore, lim(x→2) (3x+1) = 7.\n"
    "<answer>δ = ε/3; verified |3x+1-7| < ε when 0<|x-2|<δ</answer>\n\n"
)

FEW_SHOT_TORA = (
    "Example (Tool-integrated):\n"
    "Question: Evaluate ∫ x·e^x dx\n"
    "Solution: I'll use integration by parts. Let me verify with the calculator.\n"
    "<tool>\n"
    "python\n"
    "import sympy as sp\n"
    "x = sp.Symbol('x')\n"
    "sp.integrate(x*sp.exp(x), x)\n"
    "</tool>\n"
    "The calculator returns: (x - 1)*exp(x).\n"
    "This matches integration by parts: u=x, dv=e^x dx → du=dx, v=e^x.\n"
    "∫x·e^x dx = x·e^x - ∫e^x dx = x·e^x - e^x + C = (x-1)e^x + C.\n"
    "<answer>(x - 1)e^x + C</answer>\n\n"
)

FEW_SHOT_EXAMPLES = {
    "MCQ": FEW_SHOT_MCQ,
    "Short": FEW_SHOT_SHORT,
    "Proof": FEW_SHOT_PROOF,
    "EpsilonDelta": FEW_SHOT_EPSILON_DELTA,
    "ToRA": FEW_SHOT_TORA,
}


def get_few_shot(qtype: str, use_tora: bool = False) -> str:
    """Get few-shot example by question type."""
    if use_tora and qtype in ("Short", "Long"):
        return FEW_SHOT_EXAMPLES.get("ToRA", "")
    return FEW_SHOT_EXAMPLES.get(qtype, "")
