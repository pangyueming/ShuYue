# -*- coding: utf-8 -*-
"""P9 (D13): FSRS-5 spaced-repetition core — 数跃统一记忆模型。

三变量记忆状态（DSR 模型，KDD'22 / TKDE'23, MaiMemo）:
    D  Difficulty     1-10，该知识点对该学生的难度
    S  Stability      记忆稳定性 = R 降到 90% 的天数
    R  Retrievability 此刻还能回忆起的概率, R(t,S) = (1 + FACTOR·t/S)^DECAY

公式与 19 个默认参数逐字来自官方 wiki "The Algorithm"（FSRS-5 节 + v4 节的
稳定性更新式为 4.5/5 共用）:
    https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
默认参数在 2 万+ 学习者开源数据集（FSRS-Anki-20k）上预训练 —— 冷启动即优于
手调 SM-2 / BKT 文献先验（D13 修订依据）。零第三方依赖；后期可用 FSRS 优化器
按用户复习历史重拟合 19 参数（个体化升级路径）。

评级映射（产品层约定）:
    quiz/批改: 错→AGAIN(1)  部分对→HARD(2)  对→GOOD(3)  全对且未失分→EASY(4)
    前测: weak/danger→AGAIN   strong→GOOD
"""
import math

# ---------------------------------------------------------------------------
# Constants & default parameters (FSRS-5, pre-trained on FSRS-Anki-20k)
# ---------------------------------------------------------------------------
DECAY = -0.5
FACTOR = 19.0 / 81.0          # ensures R(t=S, S) == 0.9

W = [0.40255, 1.18385, 3.173, 15.69105,      # w0..w3  initial S: Again/Hard/Good/Easy
     7.1949, 0.5345,                          # w4,w5   initial D
     1.4604, 0.0046,                          # w6,w7   difficulty ΔD coeff / mean-reversion
     1.54575, 0.1192, 1.01925,                # w8..w10 recall gain / S-decay / R-impact
     1.9395, 0.11, 0.29605, 2.2698,           # w11..w14 forget base / D-decay / (S+1)-exp / R-term
     0.2315, 2.9898,                          # w15,w16 hard penalty / easy bonus
     0.51655, 0.6621]                         # w17,w18 same-day review

AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4

TARGET_R = 0.90      # requested retention — due is scheduled when R would hit this
REMIND_R = 0.85      # daily scan reminder threshold (slightly earlier than due)


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---------------------------------------------------------------------------
# Forgetting curve & interval
# ---------------------------------------------------------------------------
def retrievability(s: float, days: float) -> float:
    """R(t, S): probability of recall after `days` since last review."""
    if s <= 0:
        s = 0.1
    return (1.0 + FACTOR * max(days, 0.0) / s) ** DECAY


def interval(s: float, r: float = TARGET_R) -> float:
    """Days until R drops to `r` (the review interval). I(S, 0.9) == S."""
    return max(s / FACTOR * (r ** (1.0 / DECAY) - 1.0), 0.01)


# ---------------------------------------------------------------------------
# Initial state (first review)
# ---------------------------------------------------------------------------
def init_stability(g: int) -> float:
    return max(W[g - 1], 0.1)


def init_difficulty(g: int) -> float:
    return _clamp(W[4] - math.exp(W[5] * (g - 1)) + 1.0, 1, 10)


# ---------------------------------------------------------------------------
# State update (subsequent reviews)
# ---------------------------------------------------------------------------
def next_difficulty(d: float, g: int) -> float:
    """FSRS-5: linear damping + mean reversion toward D0(Easy)."""
    delta = -W[6] * (g - 3)
    d_prime = d + delta * (10.0 - d) / 9.0
    d_rev = W[7] * init_difficulty(EASY) + (1.0 - W[7]) * d_prime
    return _clamp(d_rev, 1, 10)


def next_stability(d: float, s: float, r: float, g: int, same_day: bool = False) -> float:
    """S' given rating G and retrievability R at review time.

    same_day (FSRS-5):  S' = S · e^{w17·(G-3+w18)}
    recall  (G>=2):     S' = S · (1 + e^{w8}·(11-D)·S^{-w9}·(e^{w10(1-R)}-1)·hard·easy)
    forget  (G==AGAIN): S' = w11 · D^{-w12} · ((S+1)^{w13} - 1) · e^{w14(1-R)}
    """
    if same_day:
        return max(s * math.exp(W[17] * (g - 3 + W[18])), 0.1)
    if g == AGAIN:
        post = (W[11] * (d ** (-W[12])) * (((s + 1.0) ** W[13]) - 1.0)
                * math.exp(W[14] * (1.0 - r)))
        return max(min(post, s), 0.1)          # never above pre-lapse S
    hard = W[14 + 1] if g == HARD else 1.0      # w15
    easy = W[15 + 1] if g == EASY else 1.0      # w16
    inc = (math.exp(W[8]) * (11.0 - d) * (s ** (-W[9]))
           * (math.exp(W[10] * (1.0 - r)) - 1.0) * hard * easy)
    return max(s * (1.0 + inc), 0.1)
