"""
Generate UK Math Test Set (50 questions)
Usage: python generate_test_set.py
"""
import json

TEST_SET = [
    # ==================== CALCULUS: LIMITS ====================
    {
        "id": "lim_001",
        "topic": "Limits",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "Evaluate the limit: lim(x→0) (sin(3x) / x)",
        "answer": "3",
        "answer_type": "exact"
    },
    {
        "id": "lim_002",
        "topic": "Limits",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Evaluate the limit: lim(x→∞) (1 + 1/x)^x",
        "answer": "e",
        "answer_type": "exact"
    },
    {
        "id": "lim_003",
        "topic": "Limits",
        "qtype": "Proof",
        "difficulty": "hard",
        "question": "Using the ε-δ definition, prove that lim(x→3) (2x + 1) = 7.",
        "answer": "Proof: For any ε > 0, choose δ = ε/2. Then 0 < |x-3| < δ implies |(2x+1)-7| = 2|x-3| < 2(ε/2) = ε.",
        "answer_type": "proof_structure"
    },
    {
        "id": "lim_004",
        "topic": "Limits",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Evaluate the limit: lim(x→0+) x * ln(x)",
        "answer": "0",
        "answer_type": "exact"
    },

    # ==================== CALCULUS: DIFFERENTIATION ====================
    {
        "id": "diff_001",
        "topic": "Differentiation",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "Find the derivative of f(x) = x^3 * e^x.",
        "answer": "x^2 * e^x * (3 + x)",
        "answer_type": "symbolic"
    },
    {
        "id": "diff_002",
        "topic": "Differentiation",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Find dy/dx if y = ln(x^2 + 1) / x.",
        "answer": "(2x^2 - (x^2+1)*ln(x^2+1)) / (x^2*(x^2+1))",
        "answer_type": "symbolic"
    },
    {
        "id": "diff_003",
        "topic": "Differentiation",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Find the second derivative of f(x) = sin(x^2).",
        "answer": "2*cos(x^2) - 4*x^2*sin(x^2)",
        "answer_type": "symbolic"
    },
    {
        "id": "diff_004",
        "topic": "Differentiation",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "Find the equation of the tangent line to y = x^2 at x = 2.",
        "answer": "y = 4x - 4",
        "answer_type": "exact"
    },

    # ==================== CALCULUS: INTEGRATION ====================
    {
        "id": "int_001",
        "topic": "Integration",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "Evaluate the integral: ∫ x * e^x dx",
        "answer": "(x - 1) * e^x + C",
        "answer_type": "symbolic"
    },
    {
        "id": "int_002",
        "topic": "Integration",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Evaluate the definite integral: ∫[0 to π] sin(x) dx",
        "answer": "2",
        "answer_type": "exact"
    },
    {
        "id": "int_003",
        "topic": "Integration",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Evaluate the integral: ∫ 1 / (x^2 + 4) dx",
        "answer": "(1/2) * arctan(x/2) + C",
        "answer_type": "symbolic"
    },
    {
        "id": "int_004",
        "topic": "Integration",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "Evaluate the integral: ∫ e^x * sin(x) dx",
        "answer": "(e^x * (sin(x) - cos(x))) / 2 + C",
        "answer_type": "symbolic"
    },

    # ==================== CALCULUS: SERIES ====================
    {
        "id": "ser_001",
        "topic": "Series_Convergence",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "Determine whether the series Σ (1/n^2) from n=1 to ∞ converges or diverges.",
        "answer": "converges",
        "answer_type": "exact"
    },
    {
        "id": "ser_002",
        "topic": "Series_Convergence",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Find the sum of the geometric series: Σ (1/2)^n from n=0 to ∞.",
        "answer": "2",
        "answer_type": "exact"
    },
    {
        "id": "ser_003",
        "topic": "Series_Convergence",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Use the ratio test to determine if Σ (n! / n^n) converges.",
        "answer": "converges",
        "answer_type": "exact"
    },
    {
        "id": "ser_004",
        "topic": "Series_Convergence",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "Find the Taylor series of e^x centred at x = 0, up to the x^3 term.",
        "answer": "1 + x + x^2/2 + x^3/6",
        "answer_type": "symbolic"
    },

    # ==================== LINEAR ALGEBRA ====================
    {
        "id": "la_001",
        "topic": "Linear_Algebra",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "Find the determinant of the matrix [[1, 2], [3, 4]].",
        "answer": "-2",
        "answer_type": "exact"
    },
    {
        "id": "la_002",
        "topic": "Linear_Algebra",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Find the eigenvalues of the matrix [[2, 1], [1, 2]].",
        "answer": "3, 1",
        "answer_type": "exact"
    },
    {
        "id": "la_003",
        "topic": "Linear_Algebra",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Solve the system: 2x + y = 5, x - y = 1. Find (x, y).",
        "answer": "(2, 1)",
        "answer_type": "exact"
    },
    {
        "id": "la_004",
        "topic": "Linear_Algebra",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "Find the inverse of the matrix [[1, 2, 3], [0, 1, 4], [5, 6, 0]].",
        "answer": "[[-24, 18, 5], [20, -15, -4], [-5, 4, 1]]",
        "answer_type": "exact"
    },
    {
        "id": "la_005",
        "topic": "Linear_Algebra",
        "qtype": "Proof",
        "difficulty": "hard",
        "question": "Prove that if A is an invertible matrix, then det(A^-1) = 1/det(A).",
        "answer": "Proof: det(A) * det(A^-1) = det(AA^-1) = det(I) = 1. Thus det(A^-1) = 1/det(A).",
        "answer_type": "proof_structure"
    },
    {
        "id": "la_006",
        "topic": "Linear_Algebra",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Compute the rank of the matrix [[1, 2, 3], [2, 4, 6], [1, 0, 1]].",
        "answer": "2",
        "answer_type": "exact"
    },
    {
        "id": "la_007",
        "topic": "Linear_Algebra",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Find the characteristic polynomial of [[1, 2], [3, 4]].",
        "answer": "λ^2 - 5λ - 2",
        "answer_type": "symbolic"
    },
    {
        "id": "la_008",
        "topic": "Linear_Algebra",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "Find the null space of the matrix [[1, 2, 3], [2, 4, 6]].",
        "answer": "span{(-2, 1, 0), (-3, 0, 1)}",
        "answer_type": "exact"
    },

    # ==================== PROOF TECHNIQUES ====================
    {
        "id": "pr_001",
        "topic": "Proof_Techniques",
        "qtype": "Proof",
        "difficulty": "easy",
        "question": "Prove by induction that 1 + 2 + ... + n = n(n+1)/2 for all positive integers n.",
        "answer": "Proof by induction: base case n=1 verified; assume true for n=k, then 1+...+k+(k+1) = k(k+1)/2 + (k+1) = (k+1)(k+2)/2.",
        "answer_type": "proof_structure"
    },
    {
        "id": "pr_002",
        "topic": "Proof_Techniques",
        "qtype": "Proof",
        "difficulty": "medium",
        "question": "Prove by contradiction that √2 is irrational.",
        "answer": "Proof: Assume √2 = p/q in lowest terms. Then 2q^2 = p^2, so p^2 even, p even. Let p=2k. Then 2q^2 = 4k^2, so q^2 = 2k^2, q even. Contradiction.",
        "answer_type": "proof_structure"
    },
    {
        "id": "pr_003",
        "topic": "Proof_Techniques",
        "qtype": "Proof",
        "difficulty": "medium",
        "question": "Prove that if n^2 is even, then n is even (use contrapositive).",
        "answer": "Proof: Contrapositive: if n is odd, then n^2 is odd. If n=2k+1, n^2=4k^2+4k+1=2(2k^2+2k)+1, which is odd.",
        "answer_type": "proof_structure"
    },
    {
        "id": "pr_004",
        "topic": "Proof_Techniques",
        "qtype": "Proof",
        "difficulty": "hard",
        "question": "Prove that for all real numbers a, b: a^2 + b^2 ≥ 2ab.",
        "answer": "Proof: (a-b)^2 ≥ 0 implies a^2 - 2ab + b^2 ≥ 0, thus a^2 + b^2 ≥ 2ab.",
        "answer_type": "proof_structure"
    },
    {
        "id": "pr_005",
        "topic": "Proof_Techniques",
        "qtype": "Proof",
        "difficulty": "hard",
        "question": "Prove by induction that 2^n > n^2 for all integers n ≥ 5.",
        "answer": "Proof by induction: base n=5: 32>25. Assume 2^k>k^2 for k≥5. Then 2^(k+1)=2*2^k>2k^2>(k+1)^2 for k≥5.",
        "answer_type": "proof_structure"
    },
    {
        "id": "pr_006",
        "topic": "Proof_Techniques",
        "qtype": "Proof",
        "difficulty": "medium",
        "question": "Prove that the sum of two rational numbers is rational.",
        "answer": "Proof: Let a=p/q, b=r/s. Then a+b=(ps+qr)/(qs), which is ratio of integers, hence rational.",
        "answer_type": "proof_structure"
    },
    {
        "id": "pr_007",
        "topic": "Proof_Techniques",
        "qtype": "Proof",
        "difficulty": "medium",
        "question": "Prove that there are infinitely many prime numbers.",
        "answer": "Proof: Assume finitely many primes p1,...,pn. Consider N=p1*p2*...*pn+1. N is not divisible by any pi, so has a prime factor not in the list. Contradiction.",
        "answer_type": "proof_structure"
    },
    {
        "id": "pr_008",
        "topic": "Proof_Techniques",
        "qtype": "Proof",
        "difficulty": "hard",
        "question": "Prove that the function f(x) = x^3 - 3x + 1 has exactly one root in the interval (0, 1).",
        "answer": "Proof: f(0)=1>0, f(1)=-1<0, so by IVT there is at least one root. f'(x)=3x^2-3<0 on (0,1), so f is strictly decreasing, thus exactly one root.",
        "answer_type": "proof_structure"
    },

    # ==================== DISCRETE MATH ====================
    {
        "id": "dm_001",
        "topic": "Discrete_Math",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "How many subsets does a set with 5 elements have?",
        "answer": "32",
        "answer_type": "exact"
    },
    {
        "id": "dm_002",
        "topic": "Discrete_Math",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Prove that C(n, k) = C(n, n-k) using the formula for binomial coefficients.",
        "answer": "Proof: C(n,k) = n!/(k!(n-k)!) = n!/((n-k)!k!) = C(n,n-k).",
        "answer_type": "proof_structure"
    },
    {
        "id": "dm_003",
        "topic": "Discrete_Math",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "How many ways can 8 people be seated around a circular table?",
        "answer": "5040",
        "answer_type": "exact"
    },
    {
        "id": "dm_004",
        "topic": "Discrete_Math",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Use the pigeonhole principle to show that among any 13 people, at least two share a birth month.",
        "answer": "Proof: 13 people, 12 months. By pigeonhole principle, at least ceil(13/12)=2 people share a birth month.",
        "answer_type": "proof_structure"
    },
    {
        "id": "dm_005",
        "topic": "Discrete_Math",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "Find the number of edges in a complete graph K_n.",
        "answer": "n(n-1)/2",
        "answer_type": "symbolic"
    },
    {
        "id": "dm_006",
        "topic": "Discrete_Math",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Prove A ∩ (B ∪ C) = (A ∩ B) ∪ (A ∩ C) using set algebra.",
        "answer": "Proof: x ∈ A ∩ (B ∪ C) iff x ∈ A and x ∈ B ∪ C iff x ∈ A and (x ∈ B or x ∈ C) iff (x ∈ A and x ∈ B) or (x ∈ A and x ∈ C) iff x ∈ (A ∩ B) ∪ (A ∩ C).",
        "answer_type": "proof_structure"
    },

    # ==================== PROBABILITY ====================
    {
        "id": "prob_001",
        "topic": "Probability",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "A fair die is rolled. What is the probability of getting an even number?",
        "answer": "1/2",
        "answer_type": "exact"
    },
    {
        "id": "prob_002",
        "topic": "Probability",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "If P(A) = 0.4, P(B) = 0.5, and P(A ∩ B) = 0.2, find P(A ∪ B).",
        "answer": "0.7",
        "answer_type": "exact"
    },
    {
        "id": "prob_003",
        "topic": "Probability",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "A random variable X has E[X] = 3 and Var(X) = 4. Find E[2X + 1].",
        "answer": "7",
        "answer_type": "exact"
    },
    {
        "id": "prob_004",
        "topic": "Probability",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "In a class of 30 students, 18 study Maths, 15 study Physics, and 10 study both. How many study neither?",
        "answer": "7",
        "answer_type": "exact"
    },
    {
        "id": "prob_005",
        "topic": "Probability",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "A coin is tossed 3 times. What is the probability of getting exactly 2 heads?",
        "answer": "3/8",
        "answer_type": "exact"
    },
    {
        "id": "prob_006",
        "topic": "Probability",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "X ~ N(0, 1). Find P(X > 1.96) to 3 decimal places.",
        "answer": "0.025",
        "answer_type": "numeric_tolerance"
    },

    # ==================== DIFFERENTIAL EQUATIONS ====================
    {
        "id": "de_001",
        "topic": "Differential_Equations",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Solve the differential equation: dy/dx = 2x with initial condition y(0) = 3.",
        "answer": "y = x^2 + 3",
        "answer_type": "symbolic"
    },
    {
        "id": "de_002",
        "topic": "Differential_Equations",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Solve: dy/dx = y/x. Find the general solution.",
        "answer": "y = Cx",
        "answer_type": "symbolic"
    },
    {
        "id": "de_003",
        "topic": "Differential_Equations",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "Solve the second-order ODE: y'' + 4y = 0 with y(0) = 1, y'(0) = 0.",
        "answer": "y = cos(2x)",
        "answer_type": "symbolic"
    },
    {
        "id": "de_004",
        "topic": "Differential_Equations",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "Solve using integrating factor: dy/dx + 2y = e^x.",
        "answer": "y = (e^x)/3 + C*e^(-2x)",
        "answer_type": "symbolic"
    },

    # ==================== COMPLEX NUMBERS ====================
    {
        "id": "cn_001",
        "topic": "Complex_Numbers",
        "qtype": "Short",
        "difficulty": "easy",
        "question": "Find the modulus of z = 3 + 4i.",
        "answer": "5",
        "answer_type": "exact"
    },
    {
        "id": "cn_002",
        "topic": "Complex_Numbers",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Express z = 1 + i in polar form.",
        "answer": "sqrt(2) * e^(i*pi/4)",
        "answer_type": "symbolic"
    },

    # ==================== VECTOR CALCULUS ====================
    {
        "id": "vc_001",
        "topic": "Vector_Calculus",
        "qtype": "Short",
        "difficulty": "medium",
        "question": "Find the divergence of the vector field F = (x^2, y^2, z^2).",
        "answer": "2x + 2y + 2z",
        "answer_type": "symbolic"
    },
    {
        "id": "vc_002",
        "topic": "Vector_Calculus",
        "qtype": "Short",
        "difficulty": "hard",
        "question": "Find the curl of the vector field F = (y, z, x).",
        "answer": "(-1, -1, -1)",
        "answer_type": "exact"
    },

    # ==================== MCQ EXAMPLES ====================
    {
        "id": "mcq_001",
        "topic": "Limits",
        "qtype": "MCQ",
        "difficulty": "easy",
        "question": "What is the value of lim(x→0) sin(x)/x?",
        "options": ["0", "1", "∞", "Does not exist"],
        "answer": "B",
        "answer_type": "exact"
    },
    {
        "id": "mcq_002",
        "topic": "Integration",
        "qtype": "MCQ",
        "difficulty": "medium",
        "question": "Which of the following is the integral of 1/x?",
        "options": ["x", "ln|x| + C", "e^x + C", "1/x^2 + C"],
        "answer": "B",
        "answer_type": "exact"
    },
    {
        "id": "mcq_003",
        "topic": "Linear_Algebra",
        "qtype": "MCQ",
        "difficulty": "medium",
        "question": "If A is a 3x3 matrix with det(A) = 4, what is det(2A)?",
        "options": ["8", "16", "24", "32"],
        "answer": "D",
        "answer_type": "exact"
    },
]

if __name__ == "__main__":
    # Validate and save
    print(f"Total questions: {len(TEST_SET)}")
    
    # Count by topic
    from collections import Counter
    topic_counts = Counter(q["topic"] for q in TEST_SET)
    print("\nBy topic:")
    for topic, count in sorted(topic_counts.items()):
        print(f"  {topic}: {count}")
    
    # Count by type
    type_counts = Counter(q["qtype"] for q in TEST_SET)
    print("\nBy type:")
    for qtype, count in sorted(type_counts.items()):
        print(f"  {qtype}: {count}")
    
    # Save
    output_path = r"D:\study\数跃\产品UI\harness_design\harness_improve\data\test_set_uk_50.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(TEST_SET, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to: {output_path}")
