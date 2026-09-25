"""
数跃 Harness V3 — Main Entry Point
Unified solver with Lane A/B routing, ToRA mode, and verification.
"""
import os
import re
from typing import Optional, List, Dict, Any

from models.api_client import APIClient
from core.topic_detector import TopicDetector
from core.question_classifier import QuestionClassifier
from core.router import SmartRouter, RouteDecision
from lanes.lane_a import LaneA
from lanes.lane_b import LaneB
from verification.answer_verifier import AnswerVerifier
from verification.proof_verifier import ProofVerifier
from verification.step_checker import StepChecker
from prompts.system_prompts import get_system_prompt
from prompts.few_shot import get_few_shot
from tools.notation_mapper import NotationMapper


# Default configuration
DEFAULT_MODEL = "qwen3.8-27b"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


def build_prompt(
    question_text: str,
    options: Optional[List[str]] = None,
    qtype: str = "Short",
    topic: str = "",
    use_tora: bool = False,
) -> str:
    """Build the user prompt for the model."""

    # Build option text for MCQ
    option_text = ""
    if options:
        option_lines = [f"  {chr(65+i)}. {opt}" for i, opt in enumerate(options)]
        option_text = "\n".join(option_lines)

    # Determine instruction based on type (bilingual: zh-first, EN kept for exam prep)
    if qtype == "MCQ":
        rule = "Select the single correct option (A/B/C/D). 选出唯一正确选项。"
    elif qtype == "Proof":
        rule = "Provide a rigorous mathematical proof with clear logical steps. 给出严谨、逻辑清晰的数学证明。"
    elif qtype == "Long":
        rule = "Provide a detailed explanation with mathematical justification. 给出详细解释并附数学依据。"
    else:
        rule = "Provide the final answer in simplified form. 给出最简形式的最终答案。"

    if use_tora:
        tool_note = (
            "\nYou may use the calculator for complex symbolic computations. "
            "Write <tool>python\n[code]\n</tool> when needed."
        )
    else:
        tool_note = ""

    prompt = (
        f"Solve the following first-year university mathematics problem "
        f"(中外合办大学一年级数学题).{tool_note}\n\n"
        f"Question Type: {qtype}\n"
        f"Topic: {topic}\n\n"
        f"Question:\n{question_text}\n"
    )

    if option_text:
        prompt += f"\n{option_text}\n"

    prompt += (
        f"\n{rule}\n"
        f"Show your working clearly. 过程完整清晰。\n"
        f"Put your final answer in <answer>...</answer> tags."
    )

    return prompt


def solve_question(
    question_text: str,
    options: Optional[List[str]] = None,
    api_key: Optional[str] = None,
    model: str = DEFAULT_MODEL,
    base_url: str = DEFAULT_BASE_URL,
    student_level: str = "first_year",
    student_profile: Optional[Dict] = None,
    force_lane: Optional[str] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    Main solve function — Harness V3 entry point.

    Args:
        question_text: The math question
        options: MCQ options (if any)
        api_key: DashScope API key
        model: Model name
        base_url: API endpoint
        student_level: "first_year" | "second_year" | "postgraduate"
        student_profile: Dict with "weak_topics", "strong_topics" for routing
        force_lane: "A" or "B" to override routing
        **kwargs: Additional options (max_tokens, etc.)

    Returns:
        {
            "answer": final answer string,
            "solution": full solution text,
            "topic": identified topic,
            "qtype": question type,
            "lane": "A" or "B",
            "confidence": vote confidence (0-1),
            "verified": whether verifier was used,
            "proof_assessment": dict (for proof questions),
            "step_check": dict (for step verification),
            "usage": token usage,
            "version": "v3",
        }
    """

    # Get API key
    if not api_key:
        api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise ValueError("DASHSCOPE_API_KEY not provided")

    # Initialize components
    client = APIClient(api_key=api_key, base_url=base_url, model=model)
    topic_detector = TopicDetector()
    classifier = QuestionClassifier()
    router = SmartRouter(student_profile=student_profile)

    # Detect topic and classify question
    topic_match = topic_detector.detect(question_text)
    qtype_result = classifier.classify(question_text, options)

    topic = topic_match.name
    qtype = qtype_result.qtype.value

    # Route
    if force_lane:
        decision = RouteDecision(
            lane=force_lane,
            confidence=1.0,
            reasons=["Forced by user"],
            temperature=0.0 if force_lane == "A" else 0.7,
            n_samples=1 if force_lane == "A" else 5,
            use_tora=False if force_lane == "A" else True,
            use_proof_verifier=(force_lane == "B" and qtype == "Proof"),
        )
    else:
        decision = router.route(question_text, options, topic_override=topic)

    # Build prompt
    prompt = build_prompt(
        question_text=question_text,
        options=options,
        qtype=qtype,
        topic=topic,
        use_tora=decision.use_tora,
    )

    # Execute lane
    if decision.lane == "A":
        lane = LaneA(client)
        result = lane.run(prompt, question_text, **kwargs)
    else:
        lane = LaneB(client)
        result = lane.run(
            prompt,
            question_text,
            n_samples=decision.n_samples,
            temperature=decision.temperature,
            use_tora=decision.use_tora,
            qtype=qtype,
            **kwargs,
        )

    # Post-processing
    answer = result.answer
    solution = result.solution

    # Run verifiers
    proof_assessment = None
    step_check = None
    verified = False

    if decision.use_proof_verifier and qtype == "Proof":
        pv = ProofVerifier()
        proof_assessment = pv.verify(question_text, solution)
        verified = True

    if decision.lane == "B" and solution:
        sc = StepChecker()
        step_check = sc.check_solution_steps(solution)
        verified = True

    # Build response
    response = {
        "answer": answer,
        "solution": solution,
        "topic": topic,
        "qtype": qtype,
        "lane": decision.lane,
        "confidence": result.confidence,
        "verified": verified,
        "usage": result.usage,
        "version": "v3",
        "routing_reasons": decision.reasons,
    }

    if proof_assessment:
        response["proof_assessment"] = {
            "proof_type": proof_assessment.proof_type.value,
            "overall": proof_assessment.overall,
            "score": proof_assessment.score,
            "feedback": proof_assessment.feedback,
            "sections": [
                {
                    "name": s.name,
                    "present": s.present,
                    "quality": s.quality,
                    "comment": s.comment,
                }
                for s in proof_assessment.sections
            ],
        }

    if step_check:
        response["step_check"] = step_check

    client.close()
    return response


# Backward-compatible alias
if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="数跃 Harness V3")
    p.add_argument("--question", "-q", required=True, help="Math question")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p.add_argument("--lane", choices=["A", "B"], default=None)
    p.add_argument("--api-key-env", default="DASHSCOPE_API_KEY")
    args = p.parse_args()

    api_key = os.getenv(args.api_key_env)
    result = solve_question(
        question_text=args.question,
        api_key=api_key,
        model=args.model,
        base_url=args.base_url,
        force_lane=args.lane,
    )

    print(f"\n{'='*60}")
    print(f"Topic: {result['topic']}")
    print(f"Type: {result['qtype']}")
    print(f"Lane: {result['lane']} (confidence: {result['confidence']})")
    print(f"Verified: {result['verified']}")
    print(f"Routing: {', '.join(result['routing_reasons'])}")
    print(f"\n--- Solution ---\n{result['solution']}")
    print(f"\n--- Answer ---\n{result['answer']}")

    if result.get('proof_assessment'):
        print(f"\n--- Proof Assessment ---")
        print(f"Type: {result['proof_assessment']['proof_type']}")
        print(f"Score: {result['proof_assessment']['score']}")
        print(f"Feedback: {result['proof_assessment']['feedback']}")

    print(f"\n--- Usage ---\n{result['usage']}")
    print(f"{'='*60}")
