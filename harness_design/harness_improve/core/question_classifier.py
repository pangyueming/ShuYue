"""
Question Type Classifier for university mathematics (bilingual EN/zh)
Detects MCQ / Short Answer / Proof / Long Answer / Multi-part

China-track: Chinese keyword patterns are appended so 证明/解释/下列 questions
classify correctly (a Chinese proof question MUST reach the Proof lane +
ProofVerifier — falling through to "Short" silently skips verification).
"""
import re
from enum import Enum
from dataclasses import dataclass
from typing import Optional, List


class QuestionType(Enum):
    MCQ = "MCQ"
    SHORT_ANSWER = "Short"
    PROOF = "Proof"
    LONG_ANSWER = "Long"
    MULTI_PART = "Multi"


@dataclass
class ClassificationResult:
    qtype: QuestionType
    confidence: float
    reasons: List[str]
    part_count: int = 0  # For multi-part questions


class QuestionClassifier:
    """Classifies math questions by type (bilingual EN/zh)."""

    # Proof indicators (strong signal)
    PROOF_KEYWORDS = [
        r"\bprove\b", r"\bshow\s+that\b", r"\bprove\s+that\b",
        r"\bdeduce\s+that\b", r"\bhence\s+show\b", r"\bhence\s+prove\b",
        r"\bprove\s+by\s+contradiction\b", r"\bprove\s+by\s+induction\b",
        r"\busing\s+the\s+method\s+of\s+\w+\b",
        r"\bq\.?e\.?d\b",  # QED
        # zh: proof directives (Chinese exam phrasing)
        r"证明", r"求证", r"试证", r"验证.{0,6}成立",
        r"反证", r"数学归纳法", r"用归纳法", r"证毕", r"充要条件.{0,4}证明",
    ]

    # MCQ indicators
    MCQ_PATTERNS = [
        r"\([A-D]\)\s+",  # (A) option (B) option
        r"\bA\.\s+.*\bB\.\s+.*\bC\.\s+",  # A. ... B. ... C.
        r"which\s+of\s+the\s+following",
        r"select\s+(?:the\s+)?correct\s+(?:option|answer)",
        r"\bchoose\b.*\bfrom\b",
        # zh MCQ phrasing (选择题 conventions)
        r"下列", r"正确的是", r"不正确的是", r"错误的是", r"选择题",
        r"选项", r"[A-D]､", r"（[A-D]）",
    ]

    # Long answer indicators
    LONG_KEYWORDS = [
        r"\bexplain\b", r"\bdescribe\b", r"\bdiscuss\b",
        r"\bcompare\b", r"\bcontrast\b", r"\banalyse\b",
        r"\bjustify\s+your\s+answer\b", r"\bgive\s+reasons\b",
        r"\bwhat\s+is\s+meant\s+by\b", r"\bstate\s+and\s+explain\b",
        r"\boutline\b", r"\bevaluate\b",
        # zh long-answer phrasing
        r"解释", r"说明", r"简述", r"阐述", r"讨论", r"比较", r"分析",
        r"为什么", r"论述", r"举例说明",
    ]

    # Multi-part indicators
    MULTI_PART_PATTERNS = [
        r"\n\s*\([a-d]\)\s+",           # (a) ... (b) ...
        r"\n\s*\([i-v]+\)\s+",           # (i) ... (ii) ...
        r"\bPart\s+[A-D][:.]?\s+",       # Part A ...
        r"(?:\n|^)\s*\([0-9]+\)\s*",     # (1) ... (2) ... (line start; \b fails before '(' at BOL)
        r"\([a-d]\)\s*[-–]\s*",          # (a) - ...
        r"(?:\n|^)\s*（[0-9]+）\s*",     # （1）（2） full-width zh
        r"(?:\n|^)\s*[（(][一二三四五六][）)]\s*",  # (一)(二) zh conventions
    ]

    def classify(self, text: str, options: Optional[List[str]] = None) -> ClassificationResult:
        """
        Classify a question by type.

        Priority:
        1. If options provided → MCQ
        2. If multi-part detected → Multi
        3. If proof keywords → Proof
        4. If long keywords → Long
        5. Otherwise → Short
        """
        text_lower = text.lower()
        reasons = []

        # Check 1: Explicit options → MCQ
        if options and len(options) >= 2:
            return ClassificationResult(
                QuestionType.MCQ, 1.0, ["Options provided"]
            )

        # Check 2: Multi-part
        part_count = self._count_parts(text)
        if part_count > 1:
            reasons.append(f"Detected {part_count} parts")
            return ClassificationResult(
                QuestionType.MULTI_PART, 0.9, reasons, part_count
            )

        # Check 3: Proof (strong signal)
        proof_matches = self._match_patterns(text_lower, self.PROOF_KEYWORDS)
        if proof_matches:
            reasons.append(f"Proof keywords: {', '.join(proof_matches[:3])}")
            return ClassificationResult(
                QuestionType.PROOF, 0.95, reasons
            )

        # Check 4: Long answer
        long_matches = self._match_patterns(text_lower, self.LONG_KEYWORDS)
        if long_matches:
            reasons.append(f"Long-answer keywords: {', '.join(long_matches[:3])}")
            return ClassificationResult(
                QuestionType.LONG_ANSWER, 0.8, reasons
            )

        # Check 5: MCQ without explicit options (text-based)
        mcq_matches = self._match_patterns(text, self.MCQ_PATTERNS)
        if mcq_matches:
            reasons.append("MCQ pattern detected")
            return ClassificationResult(
                QuestionType.MCQ, 0.7, reasons
            )

        # Default: Short answer
        reasons.append("Default: short answer")
        return ClassificationResult(
            QuestionType.SHORT_ANSWER, 0.6, reasons
        )

    def _match_patterns(self, text: str, patterns: List[str]) -> List[str]:
        """Return list of matched pattern descriptions."""
        matches = []
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                # Clean up pattern for display
                desc = pattern.replace(r"\b", "").replace(r"\s+", " ")
                matches.append(desc[:50])
        return matches

    def _count_parts(self, text: str) -> int:
        """Count number of parts in a multi-part question."""
        max_count = 0
        for pattern in self.MULTI_PART_PATTERNS:
            matches = re.findall(pattern, text, re.IGNORECASE)
            max_count = max(max_count, len(matches))
        return max_count
