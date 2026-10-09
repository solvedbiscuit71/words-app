from dataclasses import dataclass, field, asdict
from pathlib import Path
import os
import re


@dataclass
class Entry:
    text: str
    file: str
    ctime: float
    mtime: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Word:
    text: str
    pronunciation: str | None = None
    marked_as_hard: bool = False
    definitions: list[str] = field(default_factory=list)
    similar_words: list[str] = field(default_factory=list)
    near_antonyms: list[str] = field(default_factory=list)
    mnemonic: str | None = None
    example: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict) -> "Word":
        return Word(
            text=data["text"],
            pronunciation=data.get("pronunciation"),
            marked_as_hard=bool(data.get("marked_as_hard", False)),
            definitions=list(data.get("definitions", [])),
            similar_words=list(data.get("similar_words", [])),
            near_antonyms=list(data.get("near_antonyms", [])),
            mnemonic=data.get("mnemonic"),
            example=data.get("example"),
        )


class Vault:
    def __init__(self, lexicon_dir: str) -> None:
        self.lexicon_dir = Path(lexicon_dir)

    def fetch_all_entries(self) -> list[Entry]:
        if not self.lexicon_dir.exists():
            return []
        files = os.listdir(self.lexicon_dir)
        entries = []

        for file in files:
            token = file.split(".")
            if len(token) != 2 or token[1] != "md":
                # skip files without extension or files which are not markdown
                continue
            text = token[0].strip()
            stat = os.stat(self.lexicon_dir / file)
            ctime = stat.st_birthtime
            mtime = stat.st_mtime
            entries.append(Entry(text, file, ctime, mtime))

        return entries

    @staticmethod
    def normalize_sentence(text: str):
        return text.replace("\xa0", " ").strip()

    def fetch_word(self, entry: Entry) -> Word | None:
        path = self.lexicon_dir / entry.file
        if not path.exists():
            return None

        with open(path, encoding="utf8") as file:
            lines = [line.strip() for line in file.readlines() if line.strip()]

        word = Word(entry.text)

        for line in lines:
            if line[0] == "#":
                if line == "#hard":
                    word.marked_as_hard = True
                elif line[1] == " " and line[2:].strip() != entry.text:
                    return None
            elif line[0] == "-" or line[0] == "*":
                word.definitions.append(Vault.normalize_sentence(line[2:]))
            elif line.startswith("Similar words:"):
                words = line.split(":")[1].strip()
                word.similar_words.extend(
                    word.strip()[2:-2] for word in words.split(",")
                )
            elif line.startswith("Near antonyms:"):
                words = line.split(":")[1].strip()
                word.near_antonyms.extend(
                    word.strip()[2:-2] for word in words.split(",")
                )
            elif line.startswith("Mnemonic:"):
                sentence = line.split(":")[1].strip()
                word.mnemonic = sentence
            elif line.startswith("Example:"):
                sentence = line.split(":")[1].strip()
                word.example = sentence
            else:
                word.pronunciation = line.replace("\u200b", "")

        return word

    def _word_path(self, text: str) -> Path:
        return self.lexicon_dir / f"{text.strip()}.md"

    def word_exists(self, text: str) -> bool:
        return self._word_path(text).exists()

    def fetch_word_by_text(self, text: str) -> Word | None:
        path = self._word_path(text)
        if not path.exists():
            return None
        stat = path.stat()
        entry = Entry(text.strip(), path.name, stat.st_birthtime, stat.st_mtime)
        return self.fetch_word(entry)

    @staticmethod
    def serialize_word(word: Word) -> str:
        """Render a Word back into the markdown format used by the vault."""
        lines: list[str] = [f"# {word.text}", ""]

        if word.marked_as_hard:
            lines.append("#hard")
            lines.append("")

        if word.pronunciation:
            lines.append(word.pronunciation)
            lines.append("")

        for definition in word.definitions:
            lines.append(f"- {definition}")
        if word.definitions:
            lines.append("")

        if word.similar_words:
            links = ", ".join(f"[[{w}]]" for w in word.similar_words)
            lines.append(f"Similar words: {links}")
            lines.append("")

        if word.near_antonyms:
            links = ", ".join(f"[[{w}]]" for w in word.near_antonyms)
            lines.append(f"Near antonyms: {links}")
            lines.append("")

        if word.mnemonic:
            lines.append(f"Mnemonic: {word.mnemonic}")
            lines.append("")

        if word.example:
            lines.append(f"Example: {word.example}")
            lines.append("")

        return "\n".join(lines).rstrip() + "\n"

    def create_word(self, word: Word) -> Word:
        path = self._word_path(word.text)
        if path.exists():
            raise FileExistsError(f"word '{word.text}' already exists")
        self.lexicon_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(self.serialize_word(word), encoding="utf8")
        return word

    def update_word(self, text: str, word: Word) -> Word:
        path = self._word_path(text)
        if not path.exists():
            raise FileNotFoundError(f"word '{text}' does not exist")

        # Rename the file if the word text changed
        new_path = self._word_path(word.text)
        if new_path != path:
            if new_path.exists():
                raise FileExistsError(f"word '{word.text}' already exists")
            path.rename(new_path)
            path = new_path

        path.write_text(self.serialize_word(word), encoding="utf8")
        return word

    def delete_word(self, text: str) -> None:
        path = self._word_path(text)
        if not path.exists():
            raise FileNotFoundError(f"word '{text}' does not exist")
        path.unlink()
