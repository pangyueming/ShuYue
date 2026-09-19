"""
Smart Router: Confidence-based Lane A/B Routing
"""
from typing import Optional, Dict, List
from dataclasses import dataclass
from core.topic_detector import TopicDetector
from core.question_classifier import QuestionClassifier, QuestionType


@dataclass
class RouteDecision:
    lane: str              # "A" or "B"
    confidence: float      # 0-1
    reasons: List[str]
    temperature: float
    n_samples: int
    use_tora: bool         # Whether to enable tool use
    use_proof_verifier: bool


class SmartRouter:
    """
    Intelligent routing based on multiple signals:
    - Topic weakness
    - Question type
    - Proof keywords
    - Student history
    - Question length
    - Multi-part detection
    """

    WEAK_TOPICS = {
        "Proof_Techniques", "Discrete_Math", "Series_Convergence",
        "Linear_Algebra", "Vector_Calculus", "Group_Theory", "Real_Analysis"
    }

    # Thresholds
    LANE_B_THRESHOLD = 0.55

    def __init__(self, student_profile: Optional[Dict] = None):
        self.student_profile = student_profile or {}
        self.topic_detector = TopicDetector()
        self.question_classifier = QuestionClassifier()

    def route(
        self,
        question_text: str,
        options: Optional[List[str]] = None,
        topic_override: Optional[str] = None,
    ) -> RouteDecision:
        """
        Make routing decision based on multiple signals.
        """
        signals = []
        lane_b_score = 0.0

        # Detect topic and question type
        topic_match = self.topic_detector.detect(question_text)
        qtype_result = self.question_classifier.classify(question_text, options)

        topic = topic_override or topic_match.name
        qtype = qtype_result.qtype

        # Signal 1: Weak Topic
        if topic in self.WEAK_TOPICS:
            lane_b_score += 0.35
            signals.append(f"Weak topic: {topic} (score: {topic_match.score:.2f})")
        elif topic_match.score > 0.5:
            # Strong topic match but not weak
            lane_b_score += 0.1
            signals.append(f"Strong topic match: {topic}")

        # Signal 2: Question Type
        if qtype == QuestionType.PROOF:
            lane_b_score += 0.45
            signals.append("Question type: Proof")
        elif qtype == QuestionType.MULTI_PART:
            lane_b_score += 0.25
            signals.append(f"Multi-part question ({qtype_result.part_count} parts)")
        elif qtype == QuestionType.LONG_ANSWER:
            lane_b_score += 0.15
            signals.append("Question type: Long answer")
        elif qtype == QuestionType.MCQ:
            # MCQs are usually simpler
            lane_b_score -= 0.1
            signals.append("Question type: MCQ (simpler)")

        # Signal 3: Proof Keywords (even if not classified as Proof)
        text_lower = question_text.lower()
        proof_kws = ["prove", "show that", "deduce", "hence show", "prove by",
                     # zh proof signals (中国赛道)
                     "证明", "求证", "试证", "反证", "归纳法证明"]
        if any(kw in text_lower for kw in proof_kws):
            if qtype != QuestionType.PROOF:
                lane_b_score += 0.2
                signals.append("Contains proof keywords")

        # Signal 4: Student History
        weak_topics = self.student_profile.get("weak_topics", [])
        strong_topics = self.student_profile.get("strong_topics", [])
        if topic in weak_topics:
            lane_b_score += 0.2
            signals.append(f"Student weak topic: {topic}")
        elif topic in strong_topics:
            lane_b_score -= 0.15
            signals.append(f"Student strong topic: {topic}")

        # Signal 5: Question Length
        # zh: CJK text has no spaces — split() undercounts; count chars too
        word_count = len(question_text.split())
        char_count = len(question_text)
        effective_len = max(word_count, char_count // 2)  # 2 chars ≈ 1 word
        if effective_len > 150:
            lane_b_score += 0.15
            signals.append(f"Very long question ({effective_len} words~)")
        elif effective_len > 80:
            lane_b_score += 0.05
            signals.append(f"Long question ({effective_len} words~)")
        elif effective_len < 12:
            lane_b_score -= 0.1
            signals.append(f"Short question ({effective_len} words~)")

        # Signal 6: Complexity indicators
        complexity_markers = [
            "hence", "therefore", "using", "by considering",
            "first", "then", "finally", "subsequently",
            # zh complexity markers
            "因此", "所以", "利用", "考虑", "首先", "然后", "最后", "进而", "从而",
        ]
        complexity_count = sum(1 for m in complexity_markers if m in text_lower)
        if complexity_count >= 3:
            lane_b_score += 0.1
            signals.append(f"Complex structure ({complexity_count} markers)")

        # Decision
        # Proof verification follows the QUESTION TYPE, not the lane: an ε-δ
        # proof on a non-weak topic (e.g. Limits) may still route to Lane A —
        # the keyword-checklist verifier is cheap and must always run for proofs.
        wants_proof_verifier = (qtype == QuestionType.PROOF or topic == "Proof_Techniques")
        if lane_b_score >= self.LANE_B_THRESHOLD:
            return RouteDecision(
                lane="B",
                confidence=min(lane_b_score, 1.0),
                reasons=signals,
                temperature=0.7,
                n_samples=5,
                use_tora=self._should_use_tora(topic, qtype),
                use_proof_verifier=wants_proof_verifier
            )
        else:
            return RouteDecision(
                lane="A",
                confidence=max(1.0 - lane_b_score, 0.0),
                reasons=signals,
                temperature=0.0,
                n_samples=1,
                use_tora=False,
                use_proof_verifier=wants_proof_verifier
            )

    def _should_use_tora(self, topic: str, qtype: QuestionType) -> bool:
        """Determine if ToRA (tool use) should be enabled."""
        tora_topics = {
            "Integration", "Differentiation", "Linear_Algebra",
            "Series_Convergence", "Differential_Equations",
            "Vector_Calculus", "Numerical_Methods"
        }
        return topic in tora_topics and qtype != QuestionType.PROOF
