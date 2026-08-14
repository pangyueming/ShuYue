"""
Abstract Base Class for Lanes
"""
from abc import ABC, abstractmethod
from typing import Dict, Any
from models.api_client import APIClient


class LaneResult:
    """Standard result container for all lanes."""

    def __init__(
        self,
        answer: str = "",
        solution: str = "",
        usage: Dict[str, Any] = None,
        error: str = "",
        confidence: float = 1.0,
        n_samples: int = 1,
        metadata: Dict[str, Any] = None,
    ):
        self.answer = answer
        self.solution = solution
        self.usage = usage or {}
        self.error = error
        self.confidence = confidence
        self.n_samples = n_samples
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "answer": self.answer,
            "solution": self.solution,
            "usage": self.usage,
            "error": self.error,
            "confidence": self.confidence,
            "n_samples": self.n_samples,
            "metadata": self.metadata,
        }


class BaseLane(ABC):
    """Abstract base for all lanes."""

    def __init__(self, client: APIClient):
        self.client = client

    @abstractmethod
    def run(self, prompt: str, question_text: str, **kwargs) -> LaneResult:
        """Execute the lane and return result."""
        pass
