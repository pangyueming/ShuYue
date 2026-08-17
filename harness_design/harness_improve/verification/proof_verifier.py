"""
Proof Verifier: Structured proof validation using model-graded assessment
"""
import json
import re
from enum import Enum
from typing import Dict, List, Optional
from dataclasses import dataclass

from prompts.system_prompts import get_system_prompt


class ProofType(Enum):
    INDUCTION = "induction"
    CONTRADICTION = "contradiction"
    EPSILON_DELTA = "epsilon_delta"
    DIRECT = "direct"
    CONTRAPOSITIVE = "contrapositive"
    CONSTRUCTION = "construction"
    COUNTEREXAMPLE = "counterexample"
    UNKNOWN = "unknown"


@dataclass
class SectionGrade:
    name: str
    present: bool
    quality: str  # "strong", "partial", "missing"
    comment: str


@dataclass
class ProofAssessment:
    proof_type: ProofType
    sections: List[SectionGrade]
    overall: str  # "pass", "needs_revision", "fail"
    score: float  # 0-1
    feedback: str


class ProofVerifier:
    """
    Verifies mathematical proof structure.
    Uses checklist-based assessment (can be enhanced with LLM grading).
    """

    RUBRICS = {
        ProofType.INDUCTION: {
            "sections": [
                ("base_case", ["base case", "n = 1", "n = 0", "first case", "initial case"]),
                ("inductive_hypothesis", ["assume", "inductive hypothesis", "suppose", "p(k)", "hypothesis"]),
                ("inductive_step", ["therefore", "thus", "hence", "p(k+1)", "inductive step", "show that"]),
                ("conclusion", ["by induction", "principle of mathematical induction", "qed", "proved"]),
            ]
        },
        ProofType.CONTRADICTION: {
            "sections": [
                ("assumption", ["suppose not", "assume", "for contradiction", "contrary"]),
                ("derivation", ["then", "therefore", "implies", "follows that", "thus"]),
                ("contradiction", ["contradiction", "which contradicts", "absurd", "impossible"]),
                ("conclusion", ["must be true", "therefore", "qed", "proved", "established"]),
            ]
        },
        ProofType.EPSILON_DELTA: {
            "sections": [
                ("given_epsilon", ["let ε", "given ε", "for any ε > 0", "arbitrary ε", "∀ε > 0"]),
                ("find_delta", ["choose δ", "let δ", "set δ", "define δ", "take δ"]),
                ("verification", ["|f(x)", "< ε", "whenever", "implies", "|x -", "distance"]),
                ("conclusion", ["therefore", "lim", "= l", "qed", "proved"]),
            ]
        },
        ProofType.DIRECT: {
            "sections": [
                ("setup", ["let", "suppose", "given", "since", "as"]),
                ("derivation", ["then", "therefore", "thus", "hence", "it follows"]),
                ("conclusion", ["therefore", "thus", "hence", "qed", "proved"]),
            ]
        },
        ProofType.CONTRAPOSITIVE: {
            "sections": [
                ("statement", ["contrapositive", "equivalent to", "instead prove"]),
                ("proof_body", ["assume", "then", "therefore"]),
                ("conclusion", ["contrapositive", "therefore", "qed"]),
            ]
        },
    }

    def __init__(self, client=None):
        # Optional APIClient. When provided and use_llm=True, verify() adds an
        # LLM semantic grading pass on top of the structural checklist.
        self.client = client

    def detect_proof_type(self, question: str, solution: str) -> ProofType:
        """Detect the type of proof from question and solution text."""
        text = (question + " " + solution).lower()

        scores = {
            ProofType.INDUCTION: 0,
            ProofType.CONTRADICTION: 0,
            ProofType.EPSILON_DELTA: 0,
            ProofType.CONTRAPOSITIVE: 0,
            ProofType.DIRECT: 0,
        }

        # Indication keywords
        if any(k in text for k in ["induction", "inductive", "base case", "inductive step"]):
            scores[ProofType.INDUCTION] += 3
        if any(k in text for k in ["contradiction", "assume not", "suppose not"]):
            scores[ProofType.CONTRADICTION] += 3
        if any(k in text for k in ["ε-δ", "epsilon-delta", "limit", "given ε", "choose δ"]):
            scores[ProofType.EPSILON_DELTA] += 3
        if "contrapositive" in text:
            scores[ProofType.CONTRAPOSITIVE] += 3
        if "prove" in text and scores[ProofType.INDUCTION] == 0 and scores[ProofType.CONTRADICTION] == 0:
            scores[ProofType.DIRECT] += 1

        # Solution-based clues
        if "assume p(k)" in text or "inductive hypothesis" in text:
            scores[ProofType.INDUCTION] += 2
        if "contradiction" in text and "therefore" in text:
            scores[ProofType.CONTRADICTION] += 2
        if "δ =" in text and "ε" in text:
            scores[ProofType.EPSILON_DELTA] += 2

        best_type = max(scores, key=scores.get)
        if scores[best_type] == 0:
            return ProofType.UNKNOWN
        return best_type

    def verify(self, question: str, solution: str, use_llm: bool = False) -> ProofAssessment:
        """
        Verify a proof.

        Always runs the structural (keyword-checklist) assessment first. When
        ``use_llm`` is True and a client is configured, adds an LLM semantic
        grading pass that checks MATHEMATICAL CORRECTNESS — not just keyword
        presence — and returns that result when it succeeds. Any LLM failure
        falls back to the structural assessment rather than crashing.
        """
        proof_type = self.detect_proof_type(question, solution)
        structural = self._assess_structure(proof_type, solution)

        if use_llm and self.client is not None:
            try:
                llm_assessment = self._llm_grade(
                    question, solution, proof_type, structural
                )
                if llm_assessment is not None:
                    return llm_assessment
            except Exception:
                # Never let an LLM failure crash verification; fall back.
                pass

        return structural

    def _assess_structure(self, proof_type: ProofType, solution: str) -> ProofAssessment:
        """Keyword-checklist structural assessment (fast, deterministic)."""
        if proof_type == ProofType.UNKNOWN or proof_type not in self.RUBRICS:
            # Generic assessment
            return self._generic_verify(solution)

        rubric = self.RUBRICS[proof_type]
        sections = []
        solution_lower = solution.lower()
        total_score = 0

        for section_name, keywords in rubric["sections"]:
            matched_kws = [kw for kw in keywords if kw in solution_lower]
            present = len(matched_kws) > 0

            if present:
                # Quality based on number of matched keywords
                if len(matched_kws) >= 2:
                    quality = "strong"
                    score = 1.0
                else:
                    quality = "partial"
                    score = 0.5
            else:
                quality = "missing"
                score = 0.0

            sections.append(SectionGrade(
                name=section_name,
                present=present,
                quality=quality,
                comment=f"Matched: {matched_kws[:2]}" if matched_kws else "Not found"
            ))
            total_score += score

        max_score = len(rubric["sections"])
        normalized_score = total_score / max_score if max_score > 0 else 0

        # Determine overall
        if normalized_score >= 0.8:
            overall = "pass"
        elif normalized_score >= 0.5:
            overall = "needs_revision"
        else:
            overall = "fail"

        # Generate feedback
        missing = [s.name for s in sections if s.quality == "missing"]
        partial = [s.name for s in sections if s.quality == "partial"]

        feedback_parts = []
        if missing:
            feedback_parts.append(f"Missing sections: {', '.join(missing)}.")
        if partial:
            feedback_parts.append(f"Sections needing improvement: {', '.join(partial)}.")
        if not missing and not partial:
            feedback_parts.append("Well-structured proof with all required elements.")

        feedback = " ".join(feedback_parts)

        return ProofAssessment(
            proof_type=proof_type,
            sections=sections,
            overall=overall,
            score=round(normalized_score, 3),
            feedback=feedback,
        )

    def _generic_verify(self, solution: str) -> ProofAssessment:
        """Generic proof verification when type is unknown."""
        solution_lower = solution.lower()

        # Check for basic proof elements
        has_logic = any(w in solution_lower for w in ["therefore", "thus", "hence", "since"])
        has_structure = len(solution.split("\n")) >= 3
        has_conclusion = any(w in solution_lower for w in ["qed", "proved", "therefore"])

        score = 0
        if has_logic:
            score += 0.3
        if has_structure:
            score += 0.3
        if has_conclusion:
            score += 0.4

        if score >= 0.7:
            overall = "pass"
        elif score >= 0.4:
            overall = "needs_revision"
        else:
            overall = "fail"

        return ProofAssessment(
            proof_type=ProofType.UNKNOWN,
            sections=[],
            overall=overall,
            score=round(score, 3),
            feedback="Generic assessment: " + (
                "Basic proof structure present." if score > 0.5 else "Proof structure unclear."
            ),
        )

    def _llm_grade(
        self,
        question: str,
        solution: str,
        proof_type: ProofType,
        structural: ProofAssessment,
    ) -> Optional[ProofAssessment]:
        """
        LLM-based semantic grading of a proof.

        Unlike the structural checklist (which only checks whether expected
        keywords are present), this asks the model to judge MATHEMATICAL
        CORRECTNESS and LOGICAL RIGOUR. Returns None when the LLM is
        unavailable or returns unparseable output.
        """
        structural_summary = "\n".join(
            f"- {s.name}: {s.quality}" for s in structural.sections
        ) or "(no structural sections)"

        prompt = (
            f"Proof type: {proof_type.value}\n\n"
            f"Question:\n{question}\n\n"
            f"Student solution:\n{solution}\n\n"
            f"Structural checklist result (keyword-based only, may be misleading):\n"
            f"{structural_summary}\n\n"
            "Grade the proof for MATHEMATICAL CORRECTNESS and LOGICAL RIGOUR, "
            "not just keyword presence. A proof can contain every expected "
            "keyword yet be mathematically wrong, or be correct but terse. "
            "Identify the first substantive error if any.\n\n"
            'Respond with ONLY a JSON object (no markdown fences), exactly this shape:\n'
            '{"overall": "pass" or "needs_revision" or "fail", '
            '"score": <number 0.0 to 1.0>, '
            '"is_mathematically_correct": <true or false>, '
            '"feedback": "<one or two sentences of constructive feedback>"}'
        )

        text, usage, error = self.client.chat_completion(
            messages=[
                {"role": "system", "content": get_system_prompt("proof_verifier")},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=500,
        )
        if error or not text:
            return None

        data = self._parse_llm_json(text)
        if data is None:
            return None

        overall = data.get("overall")
        if overall not in ("pass", "needs_revision", "fail"):
            overall = structural.overall

        try:
            score = float(data.get("score", structural.score))
        except (TypeError, ValueError):
            score = structural.score
        score = max(0.0, min(1.0, score))

        feedback = str(data.get("feedback") or structural.feedback)

        return ProofAssessment(
            proof_type=proof_type,
            sections=structural.sections,
            overall=overall,
            score=round(score, 3),
            feedback=feedback,
        )

    @staticmethod
    def _parse_llm_json(text: str) -> Optional[Dict]:
        """Parse a JSON object out of LLM output, tolerating code fences."""
        cleaned = (text or "").strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        try:
            data = json.loads(cleaned)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
        # Fallback: extract the first {...} block.
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
        return None

    def format_assessment(self, assessment: ProofAssessment) -> str:
        """Format assessment as readable string."""
        lines = [
            f"Proof Type: {assessment.proof_type.value}",
            f"Overall: {assessment.overall.upper()} (score: {assessment.score})",
            "",
        ]

        for section in assessment.sections:
            icon = "✅" if section.quality == "strong" else "⚠️" if section.quality == "partial" else "❌"
            lines.append(f"{icon} {section.name}: {section.quality.upper()} — {section.comment}")

        lines.append("")
        lines.append(f"Feedback: {assessment.feedback}")

        return "\n".join(lines)
