"""
Lane B: Complex Questions — Multi-sample voting + ToRA tool use
For proofs, complex calculations, and weak topics.
"""
import re
from collections import Counter
from typing import List, Tuple
from lanes.lane_base import BaseLane, LaneResult
from prompts.system_prompts import get_system_prompt
from prompts.few_shot import get_few_shot
from tools.notation_mapper import NotationMapper
from tools.sympy_executor import SymPyExecutor


class LaneB(BaseLane):
    """Lane B: Self-consistency voting with optional ToRA mode."""

    def __init__(self, client):
        super().__init__(client)
        self.executor = SymPyExecutor()

    def run(
        self,
        prompt: str,
        question_text: str,
        n_samples: int = 5,
        temperature: float = 0.7,
        use_tora: bool = False,
        **kwargs
    ) -> LaneResult:
        """
        Run Lane B with multi-sample voting.
        If use_tora=True, enable tool-integrated reasoning.
        """
        qtype = kwargs.get("qtype", "Short")
        few_shot = get_few_shot(qtype, use_tora=use_tora)

        # Build full prompt
        system_prompt = get_system_prompt("tora" if use_tora else "solve")
        full_prompt = f"{few_shot}{prompt}" if few_shot else prompt

        collected: List[Tuple[str, str, str]] = []  # (answer, normalized, raw)
        total_usage = {}

        for i in range(n_samples):
            if use_tora:
                raw, usage = self._run_tora_turn(system_prompt, full_prompt)
            else:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": full_prompt},
                ]
                raw, usage, error = self.client.chat_completion(
                    messages=messages,
                    temperature=temperature,
                    max_tokens=kwargs.get("max_tokens", 4096),
                )
                if error:
                    continue

            # Clean and extract
            clean_raw = self._clean_thinking(raw)
            answer = self._extract_answer(clean_raw)
            norm = NotationMapper.normalize_for_comparison(answer)

            collected.append((answer, norm, clean_raw))

            # Accumulate usage
            for k, v in (usage or {}).items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    total_usage[k] = total_usage.get(k, 0) + v

        if not collected:
            return LaneResult(error="All samples failed", usage=total_usage)

        # Vote
        pred, confidence = self._vote(collected)
        best_raw = next(
            (raw for ans, norm, raw in collected if norm == pred), collected[0][2]
        )

        return LaneResult(
            answer=pred,
            solution=best_raw,
            usage=total_usage,
            confidence=confidence,
            n_samples=len(collected),
            metadata={
                "all_answers": [c[0] for c in collected],
                "use_tora": use_tora,
            },
        )

    def _run_tora_turn(self, system_prompt: str, prompt: str) -> Tuple[str, dict]:
        """
        Run ToRA mode: multi-turn interaction with tool execution.
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]

        full_response = ""
        total_usage = {}
        max_turns = 5

        for turn in range(max_turns):
            text, usage, error = self.client.chat_completion(
                messages=messages,
                temperature=0.7,
                max_tokens=4096,
            )
            if error:
                break

            full_response += text

            # Accumulate usage
            for k, v in (usage or {}).items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    total_usage[k] = total_usage.get(k, 0) + v

            # Check for tool call
            tool_match = re.search(
                r"<tool>\s*python\s*(.*?)\s*</tool>",
                text, re.DOTALL,
            )

            if not tool_match:
                break

            # Execute tool
            code = tool_match.group(1).strip()
            result = self.executor.execute(code)

            # Build tool result message
            if result["success"]:
                tool_msg = (
                    f"[Calculator Result]\n"
                    f"Output: {result['result']}\n"
                )
                if result["latex"]:
                    tool_msg += f"LaTeX: {result['latex']}\n"
            else:
                tool_msg = f"[Calculator Error] {result['error']}\n"

            messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": tool_msg})

        return full_response, total_usage

    def _vote(self, collected: List[Tuple[str, str, str]]) -> Tuple[str, float]:
        """Self-consistency voting among samples."""
        norm_counter = Counter(norm for _, norm, _ in collected if norm)

        if norm_counter:
            winner_norm, count = norm_counter.most_common(1)[0]
            pred = next(
                ans for ans, norm, _ in collected if norm == winner_norm
            )
            confidence = round(count / max(len(collected), 1), 3)
            return pred, confidence

        # No consensus, return first
        return collected[0][0], 1.0 / max(len(collected), 1)

    def _clean_thinking(self, text: str) -> str:
        return re.sub(r"<thinking>.*?</thinking>", "", text, flags=re.DOTALL).strip()

    def _extract_answer(self, text: str) -> str:
        """Extract answer from response."""
        m = re.search(r"<answer>(.*?)</answer>", text, re.DOTALL)
        if m:
            return m.group(1).strip()

        m = re.search(r"\\boxed\{([^{}]+)\}", text)
        if m:
            return m.group(1).strip()

        m = re.search(
            r"(?:answer is|answer:|therefore|hence|thus|the result is"
            r"|答案是|答案为|答案:|所以|因此|故|于是|得到|其值为|即为)\s*[:：]?\s*([^\n.。]{1,100})",
            text, re.IGNORECASE,
        )
        if m:
            ans = m.group(1).strip().strip(".,;，。；：: ")
            if len(ans) > 1:
                return ans

        m = re.findall(r"-?\d+(?:\.\d+)?(?:/\d+)?(?:π|pi)?", text)
        if m:
            return m[-1]

        return text[-200:].strip()
