#!/usr/bin/env python
"""FastAPI backend for the Words vocabulary app.

Serves the REST API (backed by the Obsidian vault) and hosts the static
frontend (HTML/CSS/JS) from the same server, so there is only one process
to run.
"""

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from obsidian import Vault, Word
from ollama import Ollama

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# The vault directory can be overridden with the LEXICON_DIR env var.
LEXICON_DIR = os.getenv("LEXICON_DIR", str(BASE_DIR / "Lexicon"))

vault = Vault(LEXICON_DIR)
ollama = Ollama()

app = FastAPI(
    title="Words API",
    description="Vocabulary quiz backend backed by an Obsidian vault.",
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class WordModel(BaseModel):
    text: str = Field(..., min_length=1)
    pronunciation: str | None = None
    marked_as_hard: bool = False
    definitions: list[str] = Field(default_factory=list)
    similar_words: list[str] = Field(default_factory=list)
    near_antonyms: list[str] = Field(default_factory=list)
    mnemonic: str | None = None
    example: str | None = None

    def to_word(self) -> Word:
        return Word.from_dict(self.model_dump())


class QuestionRequest(BaseModel):
    word: str
    definitions: list[str] = Field(default_factory=list)


class QuestionResponse(BaseModel):
    question: str


# ---------------------------------------------------------------------------
# Word CRUD
# ---------------------------------------------------------------------------
@app.get("/api/words")
def list_words():
    """Return lightweight metadata for every word in the vault."""
    entries = vault.fetch_all_entries()
    entries.sort(key=lambda e: e.text.lower())
    return [entry.to_dict() for entry in entries]


@app.get("/api/words/{text}")
def get_word(text: str):
    word = vault.fetch_word_by_text(text)
    if word is None:
        raise HTTPException(status_code=404, detail=f"word '{text}' not found")
    return word.to_dict()


@app.post("/api/words", status_code=201)
def create_word(payload: WordModel):
    try:
        word = vault.create_word(payload.to_word())
    except FileExistsError as err:
        raise HTTPException(status_code=409, detail=str(err))
    return word.to_dict()


@app.put("/api/words/{text}")
def update_word(text: str, payload: WordModel):
    try:
        word = vault.update_word(text, payload.to_word())
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    except FileExistsError as err:
        raise HTTPException(status_code=409, detail=str(err))
    return word.to_dict()


@app.delete("/api/words/{text}", status_code=204)
def delete_word(text: str):
    try:
        vault.delete_word(text)
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err))
    return None


# ---------------------------------------------------------------------------
# Quiz support
# ---------------------------------------------------------------------------
@app.get("/api/quiz/pool")
def quiz_pool():
    """Return every word with its full data.

    The quiz logic (take / sampling / choice selection) lives in the
    frontend; the backend only supplies the data.
    """
    entries = vault.fetch_all_entries()
    words = []
    for entry in entries:
        word = vault.fetch_word(entry)
        if word is None or not word.definitions:
            continue
        data = word.to_dict()
        data["ctime"] = entry.ctime
        data["mtime"] = entry.mtime
        words.append(data)
    return words


@app.post("/api/quiz/question", response_model=QuestionResponse)
def generate_question(payload: QuestionRequest):
    """Generate a fill-in-the-blank question with Ollama."""
    if not payload.definitions:
        raise HTTPException(status_code=400, detail="definitions must not be empty")
    try:
        question = ollama.generate_question(payload.word, payload.definitions)
    except Exception as err:  # noqa: BLE001 - surface any Ollama failure
        raise HTTPException(status_code=502, detail=f"ollama error: {err}")
    return QuestionResponse(question=question)


# ---------------------------------------------------------------------------
# Static frontend (must be mounted last so /api routes take precedence)
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
