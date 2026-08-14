"""
UK Mathematical Notation Normalizer
Standardizes various notation forms to UK university conventions.
"""
import re
from typing import List, Tuple, Dict


class NotationMapper:
    """
    Maps inconsistent mathematical notation to UK standard forms.
    This improves answer extraction and comparison accuracy.
    """

    # (pattern, replacement, description)
    UK_STANDARD_MAP: List[Tuple[str, str, str]] = [
        # Complex numbers
        (r'z\s*\*', r'\\bar{z}', 'complex conjugate'),
        (r'z\\\*', r'\\bar{z}', 'complex conjugate alt'),
        (r'z̄', r'\\bar{z}', 'complex conjugate unicode'),
        (r'\\bar\{(\w+)\}', r'\\bar{\1}', 'conjugate preserve'),

        # Vectors - UK standard is bold
        (r'\\vec\{(\w+)\}', r'\\mathbf{\1}', 'vector bold'),
        (r'\\overrightarrow\{(\w+)\}', r'\\mathbf{\1}', 'vector arrow'),
        (r'\bvec\{(\w+)\}\b', r'\\mathbf{\1}', 'vector macro'),

        # Matrices - UK uses round brackets
        (r'\[\s*([a-z]_{[ijklmn]})\s*\]', r'(\1)', 'matrix brackets'),
        (r'\{\s*([a-z]_{[ijklmn]})\s*\}', r'(\1)', 'matrix braces'),

        # Derivatives
        (r"f'\(x\)", r'\\frac{df}{dx}', 'derivative f prime'),
        (r"y'\b", r'\\frac{dy}{dx}', 'derivative y prime'),
        (r"\\dot\{(\w+)\}", r'\\frac{d\1}{dt}', 'dot derivative'),

        # Partial derivatives
        (r'∂', r'\\partial', 'partial symbol'),
        (r'\\partial\s+', r'\\partial ', 'partial spacing'),

        # Integrals
        (r'∫', r'\\int', 'integral symbol'),
        (r'∮', r'\\oint', 'contour integral'),

        # Limits
        (r'lim_{(\w+)\\to([\w\d\\]+)}', r'\\lim_{\1 \\to \2}', 'limit subscript'),
        (r'\blim\s+(?!\\)', r'\\lim ', 'limit standalone'),

        # Sums and products
        (r'Σ', r'\\sum', 'sum symbol'),
        (r'∏', r'\\prod', 'product symbol'),

        # Infinity
        (r'∞', r'\\infty', 'infinity symbol'),
        (r'\binf\b(?!inity)', r'\\infty', 'infinity word'),

        # Greek letters (common unicode variants)
        (r'α', r'\\alpha', 'alpha'),
        (r'β', r'\\beta', 'beta'),
        (r'γ', r'\\gamma', 'gamma'),
        (r'δ', r'\\delta', 'delta'),
        (r'ε', r'\\epsilon', 'epsilon'),
        (r'θ', r'\\theta', 'theta'),
        (r'λ', r'\\lambda', 'lambda'),
        (r'μ', r'\\mu', 'mu'),
        (r'π', r'\\pi', 'pi'),
        (r'σ', r'\\sigma', 'sigma'),
        (r'τ', r'\\tau', 'tau'),
        (r'φ', r'\\phi', 'phi'),
        (r'ψ', r'\\psi', 'psi'),
        (r'ω', r'\\omega', 'omega'),

        # Set theory
        (r'∈', r'\\in', 'element of'),
        (r'∉', r'\\notin', 'not in'),
        (r'∪', r'\\cup', 'union'),
        (r'∩', r'\\cap', 'intersection'),
        (r'⊂', r'\\subset', 'subset'),
        (r'⊆', r'\\subseteq', 'subseteq'),
        (r'∅', r'\\emptyset', 'empty set'),

        # Logic
        (r'∀', r'\\forall', 'forall'),
        (r'∃', r'\\exists', 'exists'),
        (r'⇒', r'\\Rightarrow', 'implies'),
        (r'⇔', r'\\Leftrightarrow', 'iff'),
        (r'¬', r'\\neg', 'not'),
        (r'∧', r'\\wedge', 'and'),
        (r'∨', r'\\vee', 'or'),

        # Inequalities
        (r'≤', r'\\leq', 'less equal'),
        (r'≥', r'\\geq', 'greater equal'),
        (r'≠', r'\\neq', 'not equal'),
        (r'≈', r'\\approx', 'approximate'),

        # Absolute value and norm
        (r'\|([^|]+)\|', r'\\left|\1\\right|', 'absolute value'),

        # Angle
        (r'°', r'^\\circ', 'degrees'),

        # Ellipsis
        (r'…', r'\\ldots', 'ellipsis'),

        # Common spacing fixes
        (r'\\,', r' ', 'thin space'),
        (r'\\;', r' ', 'medium space'),
        (r'\\!', r'', 'negative space'),
        (r'\\quad', r' ', 'quad space'),
    ]

    # Topic-specific preferred notation
    TOPIC_PREFERENCES: Dict[str, Dict[str, str]] = {
        "Linear_Algebra": {
            "vector_notation": "\\mathbf{v}",
            "matrix_notation": "(a_{ij})",
            "transpose": "A^{T}",
        },
        "Vector_Calculus": {
            "gradient": "\\nabla f",
            "divergence": "\\nabla \\cdot \\mathbf{F}",
            "curl": "\\nabla \\times \\mathbf{F}",
        },
        "Complex_Numbers": {
            "conjugate": "\\bar{z}",
            "modulus": "|z|",
            "argument": "\\arg(z)",
            "real_part": "\\operatorname{Re}(z)",
            "imag_part": "\\operatorname{Im}(z)",
        },
    }

    @classmethod
    def normalize(cls, text: str, topic: str = "") -> str:
        """Normalize mathematical notation in text."""
        if not text:
            return ""

        result = text

        # Apply standard mappings
        for pattern, replacement, desc in cls.UK_STANDARD_MAP:
            try:
                result = re.sub(pattern, replacement, result)
            except re.error:
                continue

        # Remove excessive whitespace
        result = re.sub(r'\s+', ' ', result).strip()

        return result

    @classmethod
    def normalize_for_comparison(cls, text: str, topic: str = "") -> str:
        """
        Aggressive normalization for answer comparison.
        Removes all non-essential characters.
        """
        if not text:
            return ""

        s = cls.normalize(text, topic)
        s = s.lower()
        # Remove LaTeX backslashes for comparison
        s = s.replace("\\", "")
        # Standardize brackets
        s = s.replace("{", "(").replace("}", ")")
        s = s.replace("[", "(").replace("]", ")")
        # Remove spaces around operators
        s = re.sub(r'\s*([+\-*/=<>])\s*', r'\1', s)
        # Remove trailing punctuation
        s = s.rstrip(".,;:!?")

        return s

    @classmethod
    def compare_equivalent(cls, text1: str, text2: str, topic: str = "") -> bool:
        """Check if two expressions are notation-equivalent."""
        return cls.normalize_for_comparison(text1, topic) == cls.normalize_for_comparison(text2, topic)
