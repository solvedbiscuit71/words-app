import json
import re
import random
from dataclasses import dataclass
from urllib import request, error
from difflib import SequenceMatcher

OLLAMA_URL = "http://localhost:11434/api/generate"

EXERCISE_PROMPT = """Generate one fill-in-the-blanks questions for the word '{word}' (as in '{definition}'). Ensure to incorporate insights into the question to clearly indicate the answer. Output only the question. Don't output the answer. Don't output anything other than the question itself."""


@dataclass
class Model:
    name: str
    temperature: float


DEFAULT_MODEL = Model("gemma2:2b", 1)


class Ollama:
    def __init__(self, model: Model | None = None):
        self.model = model if model else DEFAULT_MODEL

    def _generate(self, prompt: str) -> str | None:
        payload = json.dumps(
            {
                "model": self.model.name,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": self.model.temperature},
            }
        ).encode()

        req = request.Request(
            OLLAMA_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=60) as res:
                data = json.loads(res.read().decode())
                return data.get("response", "").strip()
        except error.HTTPError as err:
            print(f"[ollama] unhandled exception, {err}")
        return None

    def _normalize_question(self, question: str) -> str:
        question = question.replace("*", "").strip()
        return re.sub(r"_+", "_____", question)

    def _has_answer(self, question: str, answer: str, *, threshold=0.8) -> bool:
        """Check if word exists with fuzzy matching (threshold: 80%)"""
        words = question.lower().split()

        for w in words:
            ratio = SequenceMatcher(None, w, answer.lower()).ratio()
            if ratio >= threshold:
                return True
        return False

    def generate_question(self, word: str, definition: str, *, _retry: int = 0) -> str:
        prompt = EXERCISE_PROMPT.format(word=word, definition=random.choice(definition))
        question = self._generate(prompt)
        if question is None:
            raise Exception("Ollama._generate() failed to generate an response.")

        question = self._normalize_question(question)

        if self._has_answer(question, word):
            if _retry < 3:
                # recurse to retry upto 3 times
                return self.generate_question(word, definition, _retry=_retry + 1)
            else:
                raise Exception(
                    "Ollama.generate_question() failed to generate question without answer in it."
                )

        return question
