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
        # Remove bold (**text** or __text__)
        question = re.sub(r"\*\*(.+?)\*\*", r"\1", question)
        question = re.sub(r"__(.+?)__", r"\1", question)

        # Remove italic (*text* or _text_)
        question = re.sub(r"\*(.+?)\*", r"\1", question)
        question = re.sub(r"_(.+?)_", r"\1", question)

        # Normalize the blank size
        question = re.sub(r"_+", "_____", question)
        return question

    def _parse_words(self, text: str):
        # Pattern explanation:
        # 1. [a-zA-Z]+-[a-zA-Z]+ : Words joined by hyphens (can be multiple)
        # 2. [a-zA-Z]+ : Regular words

        pattern = r"[a-zA-Z]+-[a-zA-Z]+-?[a-zA-Z]*|[a-zA-Z]+"

        matches = re.finditer(pattern, text)

        for match in matches:
            yield match.group(0)

    def _has_answer(self, question: str, answer: str, *, threshold=0.8) -> bool:
        """Check if word exists with fuzzy matching (threshold: 80%)"""

        for word in self._parse_words(question):
            ratio = SequenceMatcher(None, word.lower(), answer.lower()).ratio()
            if ratio >= threshold:
                return True
        return False

    def generate_question(
        self, word: str, definition: str | list[str], *, _retry: int = 0
    ) -> str:
        if isinstance(definition, str):
            definition = [definition]
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
