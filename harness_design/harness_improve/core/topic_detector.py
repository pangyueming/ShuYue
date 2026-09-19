"""
Enhanced Topic Detector for university mathematics (bilingual EN/zh).

China-track: topic IDs stay English (engine-internal identifiers used by
routing / quiz / grading / the knowledge graph); Chinese keyword aliases are
APPENDED so Gaokao-background students can ask in Chinese and still hit the
right topic. English keywords are kept — Sino-foreign joint programme students
study QMUL-style English math courses.
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
    """Detects math topics with confidence scores (bilingual lexicon)."""

    TOPIC_LEXICON: List[Tuple[str, List[str], float]] = [
        # (topic_name, keywords, base_weight)
        ("Limits", [
            "limit", "lim", "epsilon-delta", "ε-δ", "squeeze theorem",
            "l'hôpital", "l'hopital", "continuity", "continuous",
            "indeterminate form", "0/0", "∞/∞", "approaches",
            # zh aliases (中国赛道)
            "极限", "收敛于", "洛必达", "夹逼", "无穷小", "连续性", "左极限", "右极限", "渐近"
        ], 1.0),
        ("Differentiation", [
            "derivative", "differentiat", "tangent line",
            "chain rule", "product rule", "quotient rule",
            "implicit differentiation", "stationary point",
            "critical point", "optimisation", "maxim", "minim", "turning point",
            # zh aliases
            "导数", "求导", "微分", "链式法则", "切线", "极值", "驻点", "拐点", "单调性", "可导"
        ], 1.0),
        ("Integration", [
            "integral", "integrate", "antiderivative",
            "integration by parts", "substitution", "partial fractions",
            "definite integral", "riemann sum", "area under", "volume of revolution",
            # zh aliases
            "积分", "原函数", "分部积分", "换元", "不定积分", "定积分", "被积", "曲边梯形", "旋转体体积"
        ], 1.0),
        ("Series_Convergence", [
            "series", "converge", "diverge", "convergence", "divergence",
            "ratio test", "comparison test", "integral test", "root test",
            "power series", "taylor series", "maclaurin",
            "geometric series", "harmonic series", "p-series",
            "absolute convergence", "conditional convergence", "Σ", "sum to infinity",
            # zh aliases
            "级数", "正项级数", "交错级数", "幂级数", "泰勒", "麦克劳林", "等比级数", "调和级数", "敛散", "收敛域", "展开式"
        ], 1.0),
        ("Differential_Equations", [
            "differential equation", "ODE", "PDE",
            "first order", "second order", "higher order",
            "separable", "homogeneous", "exact",
            "particular solution", "general solution", "complementary function",
            "integrating factor", "characteristic equation",
            # zh aliases
            "微分方程", "常微分", "偏微分", "通解", "特解", "齐次方程", "特征方程", "初值问题"
        ], 1.0),
        ("Linear_Algebra", [
            "matrix", "matrices", "determinant", "trace",
            "eigenvalue", "eigenvector", "eigenspace",
            "vector space", "subspace", "linear independence", "linear dependence",
            "linear transformation", "basis", "dimension",
            "rank", "null space", "column space", "row space",
            "gram-schmidt", "diagonalis", "orthogonal", "unitary",
            "similarity", "characteristic polynomial", "cayley-hamilton",
            # zh aliases
            "矩阵", "行列式", "特征值", "特征向量", "向量空间", "线性无关", "线性相关", "线性变换",
            "基底", "维数", "秩", "正交", "相似对角化", "线性方程组", "增广矩阵", "逆矩阵", "转置"
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
            "recurrence", "recursive", "generating function",
            # zh aliases
            "离散数学", "集合论", "命题逻辑", "谓词逻辑", "真值表", "图论", "顶点", "连通",
            "组合数学", "排列组合", "鸽巢", "抽屉原理", "递推", "生成函数", "二叉树", "欧拉图", "哈密顿"
        ], 1.0),
        ("Probability", [
            "probability", "bayes", "conditional probability",
            "random variable", "expected value", "expectation", "variance",
            "standard deviation", "distribution", "pdf", "cdf",
            "normal distribution", "binomial distribution", "poisson",
            "uniform", "exponential", "joint distribution",
            "marginal", "independence", "covariance", "correlation",
            # zh aliases
            "概率", "贝叶斯", "条件概率", "随机变量", "期望", "方差", "标准差", "分布",
            "正态分布", "二项分布", "泊松", "均匀分布", "指数分布", "独立", "协方差", "相关系数", "密度函数"
        ], 1.0),
        ("Statistics", [
            "statistic", "hypothesis test", "null hypothesis", "alternative",
            "confidence interval", "significance level",
            "p-value", "type i error", "type ii error",
            "regression", "linear regression", "least squares",
            "correlation", "pearson", "spearman",
            "standard deviation", "mean", "median", "mode", "variance",
            "sampling", "estimation", "maximum likelihood", "MLE",
            # zh aliases
            "统计", "假设检验", "原假设", "置信区间", "显著性水平", "回归", "最小二乘",
            "抽样", "点估计", "最大似然", "中位数", "众数", "样本均值"
        ], 1.0),
        ("Proof_Techniques", [
            "prove", "proof", "show that", "prove that", "deduce",
            "by contradiction", "by induction", "inductive",
            "contrapositive", "if and only if", "iff",
            "qed", "hence show", "conversely",
            "for all", "there exists", "∀", "∃",
            # zh aliases
            "证明", "求证", "试证", "反证", "数学归纳法", "归纳法", "充要", "当且仅当",
            "证毕", "得证", "任取", "存在", "必要性", "充分性"
        ], 1.2),  # Higher weight because proof keywords are strong signals
        ("Complex_Numbers", [
            "complex number", "real part", "imaginary part",
            "modulus", "argument", "polar form", "cartesian form",
            "de moivre", "euler's formula", "complex conjugate",
            "roots of unity", "complex plane", "argand",
            # zh aliases
            "复数", "实部", "虚部", "模长", "辐角", "三角形式", "共轭复数", "单位根", "复平面", "棣莫弗"
        ], 1.0),
        ("Vector_Calculus", [
            "curl", "divergence", "gradient", "del operator", "∇",
            "line integral", "surface integral", "volume integral",
            "green's theorem", "stokes' theorem", "divergence theorem", "gauss' theorem",
            "scalar field", "vector field", "conservative field",
            "potential function", "jacobian",
            # zh aliases
            "旋度", "散度", "梯度算子", "曲线积分", "曲面积分", "格林公式", "斯托克斯", "高斯公式",
            "数量场", "向量场", "雅可比"
        ], 1.0),
        ("Numerical_Methods", [
            "numerical", "approximation", "newton-raphson",
            "euler method", "runge-kutta", "trapezium rule", "simpson's rule",
            "truncation error", "round-off", "finite difference",
            "interpolation", "lagrange", "numerical integration",
            # zh aliases
            "数值计算", "数值逼近", "牛顿迭代", "龙格库塔", "梯形公式", "辛普森", "截断误差", "插值", "拉格朗日插值", "差分"
        ], 1.0),
        ("Optimisation", [
            "optimise", "optimize", "linear programming",
            "lagrange multiplier", "constraint", "objective function",
            "simplex", "convex", "gradient descent", "critical point",
            # zh aliases
            "最优化", "优化问题", "线性规划", "拉格朗日乘数", "约束条件", "目标函数", "单纯形", "凸函数", "梯度下降"
        ], 1.0),
        ("Group_Theory", [
            "group", "subgroup", "coset", "lagrange's theorem",
            "homomorphism", "isomorphism", "kernel", "image",
            "cyclic group", "permutation group", "symmetric group",
            "abelian", "normal subgroup", "quotient group",
            # zh aliases
            "群论", "子群", "陪集", "同态", "同构", "循环群", "置换群", "阿贝尔", "正规子群", "商群"
        ], 1.0),
        ("Real_Analysis", [
            "supremum", "infimum", "least upper bound", "greatest lower bound",
            "completeness", "metric space", "open set", "closed set",
            "compact", "connected", "bolzano-weierstrass",
            "uniform continuity", "pointwise convergence", "uniform convergence",
            # zh aliases
            "上确界", "下确界", "实分析", "数学分析", "完备性", "度量空间", "开集", "闭集",
            "紧致", "波尔查诺", "一致连续", "逐点收敛", "一致收敛", "柯西列", "确界原理"
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
