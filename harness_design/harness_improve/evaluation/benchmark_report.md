# CogniBridge Harness Benchmark Report

**Date**: 2026-08-12T17:49:18.326556
**Model**: qwen3.6-35b-a3b
**Questions**: 55
**Modes**: direct, v2, v3

---

## Summary

| Mode | Correct | Total | Accuracy | Total Tokens | Avg Latency |
|------|---------|-------|----------|--------------|-------------|
| direct | 35 | 55 | 63.6% | 126,237 | 10.78s |
| v2 | 36 | 55 | 65.5% | 494,986 | 45.1s |
| v3 | 42 | 55 | 76.4% | 304,251 | 24.35s |

## By Topic

| Topic | direct Accuracy | v2 Accuracy | v3 Accuracy |
|------|------|------|------|
| Complex_Numbers | 2/2 | 2/2 | 2/2 |
| Differential_Equations | 3/4 | 3/4 | 3/4 |
| Differentiation | 4/4 | 4/4 | 4/4 |
| Discrete_Math | 3/6 | 3/6 | 4/6 |
| Integration | 3/5 | 4/5 | 3/5 |
| Limits | 4/5 | 4/5 | 5/5 |
| Linear_Algebra | 5/9 | 5/9 | 5/9 |
| Probability | 6/6 | 6/6 | 6/6 |
| Proof_Techniques | 0/8 | 0/8 | 4/8 |
| Series_Convergence | 3/4 | 3/4 | 4/4 |
| Vector_Calculus | 2/2 | 2/2 | 2/2 |

## Detailed Results

### lim_001 — Limits (Short, easy)
**Question**: Evaluate the limit: lim(x→0) (sin(3x) / x)
**Gold Answer**: 3

**DIRECT**: [OK] `3` (match: exact)
**V2**: [OK] `3` (match: exact)
**V3**: [OK] `3` (match: exact)
  Routing: Question type: Long answer, Short question (7 words)

### lim_002 — Limits (Short, medium)
**Question**: Evaluate the limit: lim(x→∞) (1 + 1/x)^x
**Gold Answer**: e

**DIRECT**: [OK] `e` (match: exact)
**V2**: [OK] `e` (match: exact)
**V3**: [OK] `e` (match: exact)
  Routing: Question type: Long answer, Short question (7 words)

### lim_003 — Limits (Proof, hard)
**Question**: Using the ε-δ definition, prove that lim(x→3) (2x + 1) = 7.
**Gold Answer**: Proof: For any ε > 0, choose δ = ε/2. Then 0 < |x-3| < δ implies |(2x+1)-7| = 2|x-3| < 2(ε/2) = ε.

**DIRECT**: [FAIL] `\lim_{x \to 3} (2x + 1) = 7` (match: proof_heuristic)
**V2**: [FAIL] `\lim_{x \to 3} (2x + 1) = 7` (match: proof_heuristic)
**V3**: [OK] `**Proof.** By the $\varepsilon$-$\delta$ definition of a limit, we must show that for every $\varepsilon > 0$, there exists a $\delta > 0$ such that for all $x \in \mathbb{R}$,
$$0 < |x - 3| < \delta \implies |(2x + 1) - 7| < \varepsilon.$$

Let $\varepsilon > 0$ be arbitrary. We determine a suitable $\delta$ by analysing the difference between the function and the proposed limit:
$$|(2x + 1) - 7| = |2x - 6| = 2|x - 3|.$$
We require $2|x - 3| < \varepsilon$, which simplifies to $|x - 3| < \frac{\varepsilon}{2}$. 

Motivated by this inequality, we choose $\delta = \frac{\varepsilon}{2}$. Since $\varepsilon > 0$, it follows immediately that $\delta > 0$.

Now, suppose $0 < |x - 3| < \delta$. Then:
$$|(2x + 1) - 7| = 2|x - 3| < 2\delta = 2\left(\frac{\varepsilon}{2}\right) = \varepsilon.$$
Thus, $|(2x + 1) - 7| < \varepsilon$ holds whenever $0 < |x - 3| < \delta$.

By the $\varepsilon$-$\delta$ definition of a limit, we have rigorously established that $\lim_{x \to 3} (2x + 1) = 7$. $\blacksquare$` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.37), Question type: Proof, Short question (12 words)

### lim_004 — Limits (Short, medium)
**Question**: Evaluate the limit: lim(x→0+) x * ln(x)
**Gold Answer**: 0

**DIRECT**: [OK] `0` (match: exact)
**V2**: [OK] `0` (match: exact)
**V3**: [OK] `0` (match: exact)
  Routing: Question type: Long answer, Short question (7 words)

### diff_001 — Differentiation (Short, easy)
**Question**: Find the derivative of f(x) = x^3 * e^x.
**Gold Answer**: x^2 * e^x * (3 + x)

**DIRECT**: [OK] `f'(x) = x^2 e^x (x + 3)` (match: symbolic_numbers)
**V2**: [OK] `f'(x) = x^2 e^x (x + 3)` (match: symbolic_numbers)
**V3**: [OK] `\frac{df}{dx} = x^2 e^x (x + 3)` (match: symbolic_numbers)
  Routing: Short question (9 words)

### diff_002 — Differentiation (Short, medium)
**Question**: Find dy/dx if y = ln(x^2 + 1) / x.
**Gold Answer**: (2x^2 - (x^2+1)*ln(x^2+1)) / (x^2*(x^2+1))

**DIRECT**: [OK] `\frac{2x^2 - (x^2 + 1)\ln(x^2 + 1)}{x^2(x^2 + 1)}` (match: symbolic_numbers)
**V2**: [OK] `\frac{2x^2 - (x^2 + 1)\ln(x^2 + 1)}{x^2(x^2 + 1)}` (match: symbolic_numbers)
**V3**: [OK] `\frac{2x^2 - (x^2 + 1)\ln(x^2 + 1)}{x^2(x^2 + 1)}` (match: symbolic_numbers)
  Routing: Short question (10 words)

### diff_003 — Differentiation (Short, medium)
**Question**: Find the second derivative of f(x) = sin(x^2).
**Gold Answer**: 2*cos(x^2) - 4*x^2*sin(x^2)

**DIRECT**: [OK] `2\cos(x^2) - 4x^2\sin(x^2)` (match: symbolic_numbers)
**V2**: [OK] `2\cos(x^2) - 4x^2\sin(x^2)` (match: symbolic_numbers)
**V3**: [OK] `2\cos(x^2) - 4x^2\sin(x^2)` (match: symbolic_numbers)
  Routing: Short question (8 words)

### diff_004 — Differentiation (Short, easy)
**Question**: Find the equation of the tangent line to y = x^2 at x = 2.
**Gold Answer**: y = 4x - 4

**DIRECT**: [OK] `y = 4x - 4` (match: exact)
**V2**: [OK] `y = 4x - 4` (match: exact)
**V3**: [OK] `y = 4x - 4` (match: exact)
  Routing: Short question (15 words)

### int_001 — Integration (Short, easy)
**Question**: Evaluate the integral: ∫ x * e^x dx
**Gold Answer**: (x - 1) * e^x + C

**DIRECT**: [FAIL] `xe^x - e^x + C` (match: symbolic_fallback)
**V2**: [OK] `e^x(x - 1) + C` (match: symbolic_numbers)
**V3**: [FAIL] `xe^x - e^x + C` (match: symbolic_fallback)
  Routing: Question type: Long answer, Short question (8 words)

### int_002 — Integration (Short, medium)
**Question**: Evaluate the definite integral: ∫[0 to π] sin(x) dx
**Gold Answer**: 2

**DIRECT**: [OK] `2` (match: exact)
**V2**: [OK] `2` (match: exact)
**V3**: [OK] `2` (match: exact)
  Routing: Question type: Long answer, Short question (9 words)

### int_003 — Integration (Short, medium)
**Question**: Evaluate the integral: ∫ 1 / (x^2 + 4) dx
**Gold Answer**: (1/2) * arctan(x/2) + C

**DIRECT**: [OK] `\frac{1}{2} \arctan\left(\frac{x}{2}\right) + C` (match: symbolic_numbers)
**V2**: [FAIL] `\frac{1}{2} \tan^{-1}\left(\frac{x}{2}\right) + C` (match: symbolic_fallback)
**V3**: [OK] `\frac{1}{2} \arctan\left(\frac{x}{2}\right) + C` (match: symbolic_numbers)
  Routing: Question type: Long answer, Short question (10 words)

### int_004 — Integration (Short, hard)
**Question**: Evaluate the integral: ∫ e^x * sin(x) dx
**Gold Answer**: (e^x * (sin(x) - cos(x))) / 2 + C

**DIRECT**: [FAIL] `\frac{1}{2}e^x(\sin x - \cos x) + C` (match: symbolic_fallback)
**V2**: [OK] `\frac{e^x}{2}(\sin x - \cos x) + C` (match: symbolic_numbers)
**V3**: [FAIL] `\frac{1}{2} e^x (\sin x - \cos x) + C` (match: symbolic_fallback)
  Routing: Question type: Long answer, Short question (8 words)

### ser_001 — Series_Convergence (Short, easy)
**Question**: Determine whether the series Σ (1/n^2) from n=1 to ∞ converges or diverges.
**Gold Answer**: converges

**DIRECT**: [OK] `converges` (match: exact)
**V2**: [OK] `Converges` (match: exact)
**V3**: [OK] `Converges` (match: exact)
  Routing: Weak topic: Series_Convergence (score: 0.51), Short question (13 words)

### ser_002 — Series_Convergence (Short, medium)
**Question**: Find the sum of the geometric series: Σ (1/2)^n from n=0 to ∞.
**Gold Answer**: 2

**DIRECT**: [OK] `2` (match: exact)
**V2**: [OK] `2` (match: exact)
**V3**: [OK] `2` (match: exact)
  Routing: Weak topic: Series_Convergence (score: 0.46), Short question (13 words)

### ser_003 — Series_Convergence (Short, medium)
**Question**: Use the ratio test to determine if Σ (n! / n^n) converges.
**Gold Answer**: converges

**DIRECT**: [FAIL] `The series converges.` (match: exact)
**V2**: [FAIL] `The series converges.` (match: exact)
**V3**: [OK] `Converges` (match: exact)
  Routing: Weak topic: Series_Convergence (score: 0.46), Short question (12 words)

### ser_004 — Series_Convergence (Short, hard)
**Question**: Find the Taylor series of e^x centred at x = 0, up to the x^3 term.
**Gold Answer**: 1 + x + x^2/2 + x^3/6

**DIRECT**: [OK] `1 + x + \frac{x^2}{2} + \frac{x^3}{6}` (match: symbolic)
**V2**: [OK] `1 + x + \frac{x^2}{2} + \frac{x^3}{6}` (match: symbolic)
**V3**: [OK] `1 + x + \frac{x^2}{2} + \frac{x^3}{6}` (match: symbolic)
  Routing: Weak topic: Series_Convergence (score: 0.31), Short question (16 words)

### la_001 — Linear_Algebra (Short, easy)
**Question**: Find the determinant of the matrix [[1, 2], [3, 4]].
**Gold Answer**: -2

**DIRECT**: [OK] `-2` (match: exact)
**V2**: [OK] `-2` (match: exact)
**V3**: [OK] `-2` (match: exact)
  Routing: Weak topic: Linear_Algebra (score: 0.28), Short question (10 words)

### la_002 — Linear_Algebra (Short, medium)
**Question**: Find the eigenvalues of the matrix [[2, 1], [1, 2]].
**Gold Answer**: 3, 1

**DIRECT**: [FAIL] `1, 3` (match: exact)
**V2**: [FAIL] `1, 3` (match: exact)
**V3**: [FAIL] `1, 3` (match: exact)
  Routing: Weak topic: Linear_Algebra (score: 0.28), Short question (10 words)

### la_003 — Linear_Algebra (Short, medium)
**Question**: Solve the system: 2x + y = 5, x - y = 1. Find (x, y).
**Gold Answer**: (2, 1)

**DIRECT**: [OK] `(2, 1)` (match: exact)
**V2**: [OK] `(2, 1)` (match: exact)
**V3**: [OK] `(2, 1)` (match: exact)
  Routing: Short question (16 words)

### la_004 — Linear_Algebra (Short, hard)
**Question**: Find the inverse of the matrix [[1, 2, 3], [0, 1, 4], [5, 6, 0]].
**Gold Answer**: [[-24, 18, 5], [20, -15, -4], [-5, 4, 1]]

**DIRECT**: [FAIL] `` (match: error)
  Error: 'gbk' codec can't encode character '\u2212' in position 9: illegal multibyte sequence
**V2**: [FAIL] `\begin{pmatrix} -24 & 18 & 5 \\ 20 & -15 & -4 \\ -5 & 4 & 1 \end{pmatrix}` (match: exact)
**V3**: [FAIL] `\begin{pmatrix} -24 & 18 & 5 \\ 20 & -15 & -4 \\ -5 & 4 & 1 \end{pmatrix}` (match: exact)
  Routing: Weak topic: Linear_Algebra (score: 0.14), Short question (15 words)

### la_005 — Linear_Algebra (Proof, hard)
**Question**: Prove that if A is an invertible matrix, then det(A^-1) = 1/det(A).
**Gold Answer**: Proof: det(A) * det(A^-1) = det(AA^-1) = det(I) = 1. Thus det(A^-1) = 1/det(A).

**DIRECT**: [FAIL] `\det(A^{-1}) = \frac{1}{\det(A)}` (match: proof_heuristic)
**V2**: [FAIL] `\det(A^{-1}) = \frac{1}{\det(A)}` (match: proof_heuristic)
**V3**: [FAIL] `Starting from $AA^{-1}=I$, applying the determinant gives $\det(A)\det(A^{-1})=\det(I)=1$. Since $A$ is invertible, $\det(A)\neq 0$, so dividing by $\det(A)$ yields $\det(A^{-1}) = 1/\det(A)$. $\blacksquare$` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.37), Question type: Proof, Short question (12 words)

### la_006 — Linear_Algebra (Short, medium)
**Question**: Compute the rank of the matrix [[1, 2, 3], [2, 4, 6], [1, 0, 1]].
**Gold Answer**: 2

**DIRECT**: [OK] `2` (match: exact)
**V2**: [OK] `2` (match: exact)
**V3**: [OK] `2` (match: exact)
  Routing: Weak topic: Linear_Algebra (score: 0.28), Short question (15 words)

### la_007 — Linear_Algebra (Short, medium)
**Question**: Find the characteristic polynomial of [[1, 2], [3, 4]].
**Gold Answer**: λ^2 - 5λ - 2

**DIRECT**: [OK] `\lambda^2 - 5\lambda - 2` (match: symbolic_numbers)
**V2**: [OK] `\lambda^2 - 5\lambda - 2` (match: symbolic_numbers)
**V3**: [OK] `\lambda^2 - 5\lambda - 2` (match: symbolic_numbers)
  Routing: Weak topic: Linear_Algebra (score: 0.14), Short question (9 words)

### la_008 — Linear_Algebra (Short, hard)
**Question**: Find the null space of the matrix [[1, 2, 3], [2, 4, 6]].
**Gold Answer**: span{(-2, 1, 0), (-3, 0, 1)}

**DIRECT**: [FAIL] `\text{Null}(A) = \text{span}\left\{ \begin{pmatrix} -2 \\ 1 \\ 0 \end{pmatrix}, \begin{pmatrix} -3 \\ 0 \\ 1 \end{pmatrix} \right\}` (match: exact)
**V2**: [FAIL] `\text{Null}(A) = \text{span}\left\{ \begin{pmatrix} -2 \\ 1 \\ 0 \end{pmatrix}, \begin{pmatrix} -3 \\ 0 \\ 1 \end{pmatrix} \right\}` (match: exact)
**V3**: [FAIL] `\text{span}\left\{\begin{pmatrix} -2 \\ 1 \\ 0 \end{pmatrix}, \begin{pmatrix} -3 \\ 0 \\ 1 \end{pmatrix}\right\}` (match: exact)
  Routing: Weak topic: Linear_Algebra (score: 0.28), Short question (13 words)

### pr_001 — Proof_Techniques (Proof, easy)
**Question**: Prove by induction that 1 + 2 + ... + n = n(n+1)/2 for all positive integers n.
**Gold Answer**: Proof by induction: base case n=1 verified; assume true for n=k, then 1+...+k+(k+1) = k(k+1)/2 + (k+1) = (k+1)(k+2)/2.

**DIRECT**: [FAIL] `1 + 2 + \dots + n = \frac{n(n+1)}{2} \text{ for all } n \in \mathbb{Z}^+` (match: proof_heuristic)
**V2**: [FAIL] `The statement $1 + 2 + \dots + n = \frac{n(n+1)}{2}$ is true for all positive integers $n$.` (match: proof_heuristic)
**V3**: [OK] `Proof by induction: base case n=1 verified; inductive step demonstrates P(k) ⇒ P(k+1); hence the formula holds ∀n∈ℤ⁺.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.56), Question type: Proof, Short question (18 words)

### pr_002 — Proof_Techniques (Proof, medium)
**Question**: Prove by contradiction that √2 is irrational.
**Gold Answer**: Proof: Assume √2 = p/q in lowest terms. Then 2q^2 = p^2, so p^2 even, p even. Let p=2k. Then 2q^2 = 4k^2, so q^2 = 2k^2, q even. Contradiction.

**DIRECT**: [FAIL] `\sqrt{2} \text{ is irrational}` (match: proof_heuristic)
**V2**: [FAIL] `\sqrt{2} \text{ is irrational}` (match: proof_heuristic)
**V3**: [OK] `Proof by contradiction: Assume $\sqrt{2}=a/b$ in lowest terms $\Rightarrow a^2=2b^2 \Rightarrow a,b$ both even $\Rightarrow \gcd(a,b)\geq2$, contradicting lowest-terms assumption. Hence $\sqrt{2}$ is irrational.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.37), Question type: Proof, Short question (7 words)

### pr_003 — Proof_Techniques (Proof, medium)
**Question**: Prove that if n^2 is even, then n is even (use contrapositive).
**Gold Answer**: Proof: Contrapositive: if n is odd, then n^2 is odd. If n=2k+1, n^2=4k^2+4k+1=2(2k^2+2k)+1, which is odd.

**DIRECT**: [FAIL] `The statement is proven true.` (match: proof_heuristic)
**V2**: [FAIL] `Hence proved: If $n^2$ is even, then $n$ is even.` (match: proof_heuristic)
**V3**: [OK] `Proposition: $\forall n \in \mathbb{Z},\ n^2 \text{ is even} \implies n \text{ is even}$.
Proof (by contrapositive): We prove the logically equivalent statement: if $n$ is odd, then $n^2$ is odd. Let $n$ be an arbitrary integer and assume $n$ is odd. By definition, $\exists k \in \mathbb{Z}$ such that $n = 2k + 1$. Squaring gives $n^2 = (2k+1)^2 = 4k^2 + 4k + 1 = 2(2k^2 + 2k) + 1$. Since $k \in \mathbb{Z} \implies 2k^2 + 2k \in \mathbb{Z}$, let $m = 2k^2 + 2k$. Then $n^2 = 2m + 1$, which by definition means $n^2$ is odd. Thus, $n$ odd $\implies n^2$ odd. By contraposition, the original statement holds for all $n \in \mathbb{Z}$. $\blacksquare$` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.56), Question type: Proof, Short question (12 words)

### pr_004 — Proof_Techniques (Proof, hard)
**Question**: Prove that for all real numbers a, b: a^2 + b^2 ≥ 2ab.
**Gold Answer**: Proof: (a-b)^2 ≥ 0 implies a^2 - 2ab + b^2 ≥ 0, thus a^2 + b^2 ≥ 2ab.

**DIRECT**: [FAIL] `a^2 + b^2 \geq 2ab` (match: proof_heuristic)
**V2**: [FAIL] `a^2 + b^2 \geq 2ab` (match: proof_heuristic)
**V3**: [FAIL] `` (match: error)
  Error: 'gbk' codec can't encode character '\u2200' in position 15: illegal multibyte sequence

### pr_005 — Proof_Techniques (Proof, hard)
**Question**: Prove by induction that 2^n > n^2 for all integers n ≥ 5.
**Gold Answer**: Proof by induction: base n=5: 32>25. Assume 2^k>k^2 for k≥5. Then 2^(k+1)=2*2^k>2k^2>(k+1)^2 for k≥5.

**DIRECT**: [FAIL] `2^n > n^2 for all integers n ≥ 5` (match: proof_heuristic)
**V2**: [FAIL] `By the Principle of Mathematical Induction, $2^n > n^2$ holds for all integers $n \geq 5$.` (match: proof_heuristic)
**V3**: [FAIL] `By the principle of mathematical induction, the base case $n=5$ is verified ($32>25$), and the inductive step demonstrates that $2^k > k^2 \implies 2^{k+1} > (k+1)^2$ for all $k \geq 5$. Hence, $2^n > n^2$ for all integers $n \geq 5$.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.56), Question type: Proof, Short question (13 words)

### pr_006 — Proof_Techniques (Proof, medium)
**Question**: Prove that the sum of two rational numbers is rational.
**Gold Answer**: Proof: Let a=p/q, b=r/s. Then a+b=(ps+qr)/(qs), which is ratio of integers, hence rational.

**DIRECT**: [FAIL] `The sum of two rational numbers is rational.` (match: proof_heuristic)
**V2**: [FAIL] `The sum of any two rational numbers is rational.` (match: proof_heuristic)
**V3**: [FAIL] `By the definition of rational numbers and the closure properties of integers under addition and multiplication, the sum of any two rational numbers can be expressed as a single fraction whose numerator and denominator are integers with a non-zero denominator; hence, the sum is rational.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.37), Question type: Proof, Short question (10 words)

### pr_007 — Proof_Techniques (Proof, medium)
**Question**: Prove that there are infinitely many prime numbers.
**Gold Answer**: Proof: Assume finitely many primes p1,...,pn. Consider N=p1*p2*...*pn+1. N is not divisible by any pi, so has a prime factor not in the list. Contradiction.

**DIRECT**: [FAIL] `There are infinitely many prime numbers.` (match: proof_heuristic)
**V2**: [FAIL] `There are infinitely many prime numbers.` (match: proof_heuristic)
**V3**: [OK] `Proof by contradiction: assuming a finite list of all primes allows construction of an integer N ≡ 1 (mod p_i) for every listed prime, implying N has a prime divisor outside the list. This contradicts the assumption of finiteness, hence the set of primes is infinite.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.37), Question type: Proof, Short question (8 words)

### pr_008 — Proof_Techniques (Proof, hard)
**Question**: Prove that the function f(x) = x^3 - 3x + 1 has exactly one root in the interval (0, 1).
**Gold Answer**: Proof: f(0)=1>0, f(1)=-1<0, so by IVT there is at least one root. f'(x)=3x^2-3<0 on (0,1), so f is strictly decreasing, thus exactly one root.

**DIRECT**: [FAIL] `Exactly one root in (0, 1)` (match: proof_heuristic)
**V2**: [FAIL] `The function $f(x) = x^3 - 3x + 1$ has exactly one root in the interval $(0, 1)$.` (match: proof_heuristic)
**V3**: [FAIL] `By the Intermediate Value Theorem, continuity on $[0,1]$ with $f(0)=1>0$ and $f(1)=-1<0$ guarantees at least one root in $(0,1)$. Since $f'(x)=3x^2-3<0$ for all $x\in(0,1)$, $f$ is strictly decreasing on this interval, ensuring at most one root. Hence, exactly one root exists.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.37), Question type: Proof, Short question (20 words)

### dm_001 — Discrete_Math (Short, easy)
**Question**: How many subsets does a set with 5 elements have?
**Gold Answer**: 32

**DIRECT**: [OK] `32` (match: exact)
**V2**: [OK] `32` (match: exact)
**V3**: [OK] `32` (match: exact)
  Routing: Short question (10 words)

### dm_002 — Discrete_Math (Short, medium)
**Question**: Prove that C(n, k) = C(n, n-k) using the formula for binomial coefficients.
**Gold Answer**: Proof: C(n,k) = n!/(k!(n-k)!) = n!/((n-k)!k!) = C(n,n-k).

**DIRECT**: [FAIL] `\binom{n}{k} = \binom{n}{n-k}` (match: proof_heuristic)
**V2**: [FAIL] `C(n, k) = C(n, n-k)` (match: proof_heuristic)
**V3**: [FAIL] `By direct substitution into the factorial definition $\binom{n}{m}=\frac{n!}{m!(n-m)!}$, the denominator of $\binom{n}{n-k}$ simplifies to $(n-k)!k!$, which is identical to the denominator of $\binom{n}{k}$. Thus $\binom{n}{k} = \binom{n}{n-k}$ for all $0 \leq k \leq n$.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.37), Question type: Proof, Short question (13 words)

### dm_003 — Discrete_Math (Short, medium)
**Question**: How many ways can 8 people be seated around a circular table?
**Gold Answer**: 5040

**DIRECT**: [OK] `5040` (match: exact)
**V2**: [OK] `5040` (match: exact)
**V3**: [OK] `5040` (match: exact)
  Routing: Short question (12 words)

### dm_004 — Discrete_Math (Short, medium)
**Question**: Use the pigeonhole principle to show that among any 13 people, at least two share a birth month.
**Gold Answer**: Proof: 13 people, 12 months. By pigeonhole principle, at least ceil(13/12)=2 people share a birth month.

**DIRECT**: [FAIL] `At least two people share a birth month.` (match: proof_heuristic)
**V2**: [FAIL] `At least two people share a birth month.` (match: proof_heuristic)
**V3**: [FAIL] `With 13 people (pigeons) mapped to 12 birth months (pigeonholes), the condition 13 > 12 satisfies the Pigeonhole Principle, guaranteeing that at least one month contains ≥2 people. Therefore, at least two people share a birth month.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.19), Question type: Proof, Short question (18 words)

### dm_005 — Discrete_Math (Short, hard)
**Question**: Find the number of edges in a complete graph K_n.
**Gold Answer**: n(n-1)/2

**DIRECT**: [OK] `\frac{n(n-1)}{2}` (match: symbolic)
**V2**: [OK] `\frac{n(n-1)}{2}` (match: symbolic)
**V3**: [OK] `\frac{n(n-1)}{2}` (match: symbolic)
  Routing: Weak topic: Discrete_Math (score: 0.13), Short question (10 words)

### dm_006 — Discrete_Math (Short, medium)
**Question**: Prove A ∩ (B ∪ C) = (A ∩ B) ∪ (A ∩ C) using set algebra.
**Gold Answer**: Proof: x ∈ A ∩ (B ∪ C) iff x ∈ A and x ∈ B ∪ C iff x ∈ A and (x ∈ B or x ∈ C) iff (x ∈ A and x ∈ B) or (x ∈ A and x ∈ C) iff x ∈ (A ∩ B) ∪ (A ∩ C).

**DIRECT**: [FAIL] `A ∩ (B ∪ C) = (A ∩ B) ∪ (A ∩ C)` (match: proof_heuristic)
**V2**: [FAIL] `A ∩ (B ∪ C) = (A ∩ B) ∪ (A ∩ C)` (match: proof_heuristic)
**V3**: [OK] `Proof complete: The equality is established by translating set operations into logical connectives, applying the distributive law of propositional logic to the membership conditions, and concluding via the axiom of extensionality.` (match: proof_heuristic)
  Routing: Weak topic: Proof_Techniques (score: 0.19), Question type: Proof, Short question (17 words)

### prob_001 — Probability (Short, easy)
**Question**: A fair die is rolled. What is the probability of getting an even number?
**Gold Answer**: 1/2

**DIRECT**: [OK] `1/2` (match: exact)
**V2**: [OK] `1/2` (match: exact)
**V3**: [OK] `1/2` (match: exact)
  Routing: Short question (14 words)

### prob_002 — Probability (Short, medium)
**Question**: If P(A) = 0.4, P(B) = 0.5, and P(A ∩ B) = 0.2, find P(A ∪ B).
**Gold Answer**: 0.7

**DIRECT**: [OK] `0.7` (match: exact)
**V2**: [OK] `0.7` (match: exact)
**V3**: [OK] `0.7` (match: exact)
  Routing: Question type: MCQ (simpler), Short question (17 words)

### prob_003 — Probability (Short, medium)
**Question**: A random variable X has E[X] = 3 and Var(X) = 4. Find E[2X + 1].
**Gold Answer**: 7

**DIRECT**: [OK] `7` (match: exact)
**V2**: [OK] `7` (match: exact)
**V3**: [OK] `7` (match: exact)
  Routing: Short question (16 words)

### prob_004 — Probability (Short, hard)
**Question**: In a class of 30 students, 18 study Maths, 15 study Physics, and 10 study both. How many study neither?
**Gold Answer**: 7

**DIRECT**: [OK] `7` (match: exact)
**V2**: [OK] `7` (match: exact)
**V3**: [OK] `7` (match: exact)
  Routing: Short question (20 words)

### prob_005 — Probability (Short, medium)
**Question**: A coin is tossed 3 times. What is the probability of getting exactly 2 heads?
**Gold Answer**: 3/8

**DIRECT**: [OK] `3/8` (match: exact)
**V2**: [OK] `3/8` (match: exact)
**V3**: [OK] `3/8` (match: exact)
  Routing: Short question (15 words)

### prob_006 — Probability (Short, hard)
**Question**: X ~ N(0, 1). Find P(X > 1.96) to 3 decimal places.
**Gold Answer**: 0.025

**DIRECT**: [OK] `0.025` (match: numeric)
**V2**: [OK] `0.025` (match: numeric)
**V3**: [OK] `0.025` (match: numeric)
  Routing: Short question (12 words)

### de_001 — Differential_Equations (Short, medium)
**Question**: Solve the differential equation: dy/dx = 2x with initial condition y(0) = 3.
**Gold Answer**: y = x^2 + 3

**DIRECT**: [OK] `y = x^2 + 3` (match: symbolic_fallback)
**V2**: [OK] `y = x^2 + 3` (match: symbolic_fallback)
**V3**: [OK] `y = x^2 + 3` (match: symbolic_fallback)
  Routing: Weak topic: Proof_Techniques (score: 0.19), Short question (13 words)

### de_002 — Differential_Equations (Short, medium)
**Question**: Solve: dy/dx = y/x. Find the general solution.
**Gold Answer**: y = Cx

**DIRECT**: [OK] `y = Cx` (match: symbolic_fallback)
**V2**: [OK] `y = Cx` (match: symbolic_fallback)
**V3**: [OK] `y = Cx` (match: symbolic_fallback)
  Routing: Short question (8 words)

### de_003 — Differential_Equations (Short, hard)
**Question**: Solve the second-order ODE: y'' + 4y = 0 with y(0) = 1, y'(0) = 0.
**Gold Answer**: y = cos(2x)

**DIRECT**: [OK] `y = \cos(2x)` (match: symbolic_fallback)
**V2**: [OK] `y = \cos(2x)` (match: symbolic_fallback)
**V3**: [OK] `y = \cos(2x)` (match: symbolic_fallback)
  Routing: Short question (16 words)

### de_004 — Differential_Equations (Short, hard)
**Question**: Solve using integrating factor: dy/dx + 2y = e^x.
**Gold Answer**: y = (e^x)/3 + C*e^(-2x)

**DIRECT**: [FAIL] `y = \frac{1}{3}e^x + Ce^{-2x}` (match: symbolic_fallback)
**V2**: [FAIL] `y = \frac{1}{3}e^x + Ce^{-2x}` (match: symbolic_fallback)
**V3**: [FAIL] `y = \frac{1}{3}e^x + Ce^{-2x}` (match: symbolic_fallback)
  Routing: Short question (9 words)

### cn_001 — Complex_Numbers (Short, easy)
**Question**: Find the modulus of z = 3 + 4i.
**Gold Answer**: 5

**DIRECT**: [OK] `5` (match: exact)
**V2**: [OK] `5` (match: exact)
**V3**: [OK] `5` (match: exact)
  Routing: Short question (9 words)

### cn_002 — Complex_Numbers (Short, medium)
**Question**: Express z = 1 + i in polar form.
**Gold Answer**: sqrt(2) * e^(i*pi/4)

**DIRECT**: [OK] `\sqrt{2}\left(\cos\frac{\pi}{4} + i\sin\frac{\pi}{4}\right)` (match: symbolic_numbers)
**V2**: [OK] `\sqrt{2}\left(\cos\frac{\pi}{4} + i\sin\frac{\pi}{4}\right)` (match: symbolic_numbers)
**V3**: [OK] `\sqrt{2} \left( \cos \frac{\pi}{4} + i \sin \frac{\pi}{4} \right)` (match: symbolic_numbers)
  Routing: Short question (9 words)

### vc_001 — Vector_Calculus (Short, medium)
**Question**: Find the divergence of the vector field F = (x^2, y^2, z^2).
**Gold Answer**: 2x + 2y + 2z

**DIRECT**: [OK] `2x + 2y + 2z` (match: symbolic_fallback)
**V2**: [OK] `2x + 2y + 2z` (match: symbolic_fallback)
**V3**: [OK] `2x + 2y + 2z` (match: symbolic_fallback)
  Routing: Weak topic: Vector_Calculus (score: 0.32), Short question (12 words)

### vc_002 — Vector_Calculus (Short, hard)
**Question**: Find the curl of the vector field F = (y, z, x).
**Gold Answer**: (-1, -1, -1)

**DIRECT**: [OK] `(-1, -1, -1)` (match: exact)
**V2**: [OK] `(-1, -1, -1)` (match: exact)
**V3**: [OK] `(-1, -1, -1)` (match: exact)
  Routing: Weak topic: Vector_Calculus (score: 0.32), Short question (12 words)

### mcq_001 — Limits (MCQ, easy)
**Question**: What is the value of lim(x→0) sin(x)/x?
**Gold Answer**: B

**DIRECT**: [OK] `B` (match: exact)
**V2**: [OK] `B` (match: exact)
**V3**: [OK] `B` (match: exact)
  Routing: Question type: MCQ (simpler), Short question (7 words)

### mcq_002 — Integration (MCQ, medium)
**Question**: Which of the following is the integral of 1/x?
**Gold Answer**: B

**DIRECT**: [OK] `B` (match: exact)
**V2**: [OK] `B` (match: exact)
**V3**: [OK] `B` (match: exact)
  Routing: Question type: MCQ (simpler), Short question (9 words)

### mcq_003 — Linear_Algebra (MCQ, medium)
**Question**: If A is a 3x3 matrix with det(A) = 4, what is det(2A)?
**Gold Answer**: D

**DIRECT**: [OK] `D` (match: exact)
**V2**: [OK] `D` (match: exact)
**V3**: [OK] `D` (match: exact)
  Routing: Weak topic: Linear_Algebra (score: 0.14), Question type: MCQ (simpler), Short question (13 words)
