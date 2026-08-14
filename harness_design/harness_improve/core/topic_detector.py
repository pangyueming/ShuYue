"""
Enhanced Topic Detector for UK Higher Mathematics
"""
import re
from typing import List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class TopicMatch:
    name: str
    score: float           # 0-1 confidence
    matched_keywords: List[str]


class TopicDetector:
    """Detects UK math topics with confidence scores."""

    TOPIC_LEXICON: List[Tuple[str, List[str], float]] = [
        # (topic_name, keywords, base_weight)
        ("Limits", [
            "limit", "lim", "epsilon-delta", "ε-δ", "squeeze theorem",
            "l'hôpital", "l'hopital", "continuity", "continuous",
            "indeterminate form", "0/0", "∞/∞", "approaches"
        ], 1.0),
        ("Differentiation", [
            "derivative", "differentiat", "tangent line",
            "chain rule", "product rule", "quotient rule",
            "implicit differentiation", "stationary point",
            "critical point", "optimisation", "maxim", "minim", "turning point"
        ], 1.0),
        ("Integration", [
            "integral", "integrate", "antiderivative",
            "integration by parts", "substitution", "partial fractions",
            "definite integral", "riemann sum", "area under", "volume of revolution"
        ], 1.0),
        ("Series_Convergence", [
            "series", "converge", "diverge", "convergence", "divergence",
            "ratio test", "comparison test", "integral test", "root test",
            "power series", "taylor series", "maclaurin",
            "geometric series", "harmonic series", "p-series",
            "absolute convergence", "conditional convergence", "Σ", "sum to infinity"
        ], 1.0),
        ("Differential_Equations", [
            "differential equation", "ODE", "PDE",
            "first order", "second order", "higher order",
            "separable", "homogeneous", "exact",
            "particular solution", "general solution", "complementary function",
            "integrating factor", "characteristic equation"
        ], 1.0),
        ("Linear_Algebra", [
            "matrix", "matrices", "determinant", "trace",
            "eigenvalue", "eigenvector", "eigenspace",
            "vector space", "subspace", "linear independence", "linear dependence",
            "linear transformation", "basis", "dimension",
            "rank", "null space", "column space", "row space",
            "gram-schmidt", "diagonalis", "orthogonal", "unitary",
            "similarity", "characteristic polynomial", "cayley-hamilton"
        ], 1.0),
        ("Discrete_Math", [
            "set theory", "union", "intersection", "complement", "venn",
            "propositional logic", "truth table", "predicate logic",
            "logical equivalence", "implication", "bi-implication",
            "contradiction", "tautology", "contrapositive",
            "graph theory", "vertex", "edge", "tree", "path", "cycle",
            "euler", "hamiltonian", "bipartite", "planar",
            "combinatorics", "permutation", "combination",
            "pigeonhole", "binomial coefficient", "binomial theorem",
            "recurrence", "recursive", "generating function"
        ], 1.0),
        ("Probability", [
            "probability", "bayes", "conditional probability",
            "random variable", "expected value", "expectation", "variance",
            "standard deviation", "distribution", "pdf", "cdf",
            "normal distribution", "binomial distribution", "poisson",
            "uniform", "exponential", "joint distribution",
            "marginal", "independence", "covariance", "correlation"
        ], 1.0),
        ("Statistics", [
            "statistic", "hypothesis test", "null hypothesis", "alternative",
            "confidence interval", "significance level",
            "p-value", "type i error", "type ii error",
            "regression", "linear regression", "least squares",
            "correlation", "pearson", "spearman",
            "standard deviation", "mean", "median", "mode", "variance",
            "sampling", "estimation", "maximum likelihood", "MLE"
        ], 1.0),
        ("Proof_Techniques", [
            "prove", "proof", "show that", "prove that", "deduce",
            "by contradiction", "by induction", "inductive",
            "contrapositive", "if and only if", "iff",
            "qed", "hence show", "conversely",
            "for all", "there exists", "∀", "∃"
        ], 1.2),  # Higher weight because proof keywords are strong signals
        ("Complex_Numbers", [
            "complex number", "real part", "imaginary part",
            "modulus", "argument", "polar form", "cartesian form",
            "de moivre", "euler's formula", "complex conjugate",
            "roots of unity", "complex plane", "argand"
        ], 1.0),
        ("Vector_Calculus", [
            "curl", "divergence", "gradient", "del operator", "∇",
            "line integral", "surface integral", "volume integral",
            "green's theorem", "stokes' theorem", "divergence theorem", "gauss' theorem",
            "scalar field", "vector field", "conservative field",
            "potential function", "jacobian"
        ], 1.0),
        ("Numerical_Methods", [
            "numerical", "approximation", "newton-raphson",
            "euler method", "runge-kutta", "trapezium rule", "simpson's rule",
            "truncation error", "round-off", "finite difference",
            "interpolation", "lagrange", "numerical integration"
        ], 1.0),
        ("Optimisation", [
            "optimise", "optimize", "linear programming",
            "lagrange multiplier", "constraint", "objective function",
            "simplex", "convex", "gradient descent", "critical point"
        ], 1.0),
        ("Group_Theory", [
            "group", "subgroup", "coset", "lagrange's theorem",
            "homomorphism", "isomorphism", "kernel", "image",
            "cyclic group", "permutation group", "symmetric group",
            "abelian", "normal subgroup", "quotient group"
        ], 1.0),
        ("Real_Analysis", [
            "supremum", "infimum", "least upper bound", "greatest lower bound",
            "completeness", "metric space", "open set", "closed set",
            "compact", "connected", "bolzano-weierstrass",
            "uniform continuity", "pointwise convergence", "uniform convergence"
        ], 1.0),
    ]

    # Topics that are known weak points for Qwen3.6
    WEAK_TOPICS = {
        "Proof_Techniques", "Discrete_Math", "Series_Convergence",
        "Linear_Algebra", "Vector_Calculus", "Group_Theory", "Real_Analysis"
    }

    def detect(self, text: str) -> TopicMatch:
        """
        Detect topic with confidence score.

        Algorithm:
        1. Count matched keywords per topic
        2. Score = (matched_count / total_keywords) * base_weight
        3. Bonus for multiple keyword matches
        4. Return highest scoring topic
        """
        text_lower = text.lower()
        best_match = TopicMatch("Other", 0.0, [])

        for topic_name, keywords, weight in self.TOPIC_LEXICON:
            matched = []
            for kw in keywords:
                if kw.lower() in text_lower:
                    matched.append(kw)

            if not matched:
                continue

            # Calculate score
            coverage = len(matched) / len(keywords)
            # Bonus for matching multiple distinct keywords
            diversity_bonus = min(len(matched) * 0.1, 0.3)
            score = (coverage + diversity_bonus) * weight

            if score > best_match.score:
                best_match = TopicMatch(topic_name, score, matched)

        # If no clear match, check for generic math terms
        if best_match.name == "Other":
            generic_math = ["function", "equation", "solve", "calculate",
                           "find the value", "determine", "evaluate"]
            if any(kw in text_lower for kw in generic_math):
                best_match = TopicMatch("General_Math", 0.3, ["generic"])

        return best_match

    def is_weak_topic(self, topic_name: str) -> bool:
        """Check if topic is in the weak topics list."""
        return topic_name in self.WEAK_TOPICS

    def get_all_topics(self) -> List[str]:
        """Return list of all topic names."""
        return [t[0] for t in self.TOPIC_LEXICON] + ["Other", "General_Math"]
