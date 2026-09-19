"""
Lane A: Simple Questions — Single call, temperature=0
Fast and cheap for straightforward problems.
"""
import re
from lanes.lane_base import BaseLane, LaneResult
from prompts.system_prompts import get_system_prompt
from tools.notation_mapper import NotationMapper


class LaneA(BaseLane):
    """Lane A: Single-shot deterministic solving."""

    def run(self, prompt: str, question_text: str, **kwargs) -> LaneResult:
        """Run single LLM call with temperature=0."""
        messages = [
            {"role": "system", "content": get_system_prompt("solve")},
            {"role": "user", "content": prompt},
        ]

        text, usage, error = self.client.chat_completion(
            messages=messages,
            temperature=0.0,
            max_tokens=kwargs.get("max_tokens", 4096),
        )

        if error:
            return LaneResult(error=error, usage=usage)

        # Clean thinking blocks
        text = self._clean_thinking(text)

        # Extract answer
        answer = self._extract_answer(text)

        # Normalize notation
        answer = NotationMapper.normalize(answer)

        return LaneResult(
            answer=answer,
            solution=text,
            usage=usage,
            confidence=1.0,
            n_samples=1,
        )

    def _clean_thinking(self, text: str) -> str:
        """Remove <thinking> blocks from Qwen3.6 output."""
        return re.sub(r"<thinking>.*?</thinking>", "", text, flags=re.DOTALL).strip()

    def _extract_answer(self, text: str) -> str:
        """Extract answer from response (bilingual EN/zh cues)."""
        # Try <answer> tag
        m = re.search(r"<answer>(.*?)</answer>", text, re.DOTALL)
        if m:
            return m.group(1).strip()

        # Try \boxed{}
        m = re.search(r"\\boxed\{([^{}]+)\}", text)
        if m:
            return m.group(1).strip()

        # Try "Answer:" or "Therefore" — zh cues: 答案是/所以/因此/故/得到/为
        m = re.search(
            r"(?:answer is|answer:|therefore|hence|thus|the result is"
            r"|答案是|答案为|答案:|所以|因此|故|于是|得到|其值为|即为)\s*[:：]?\s*([^\n.。]{1,100})",
            text, re.IGNORECASE,
        )
        if m:
            ans = m.group(1).strip().strip(".,;，。；：: ")
            if len(ans) > 1 and not any(w in ans.lower() for w in
                ["we have", "it follows", "by the", "from the", "since",
                 "我们", "由此", "根据", "由于"]):
                return ans

        # Fallback: last number/expression
        m = re.findall(r"-?\d+(?:\.\d+)?(?:/\d+)?(?:π|pi)?", text)
        if m:
            return m[-1]

        return text[-200:].strip()
