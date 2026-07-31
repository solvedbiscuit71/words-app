from dataclasses import dataclass, field
from pathlib import Path
import os


@dataclass
class Entry:
    text: str
    file: str
    ctime: float
    mtime: float


@dataclass
class Word:
    text: str
    pronunciation: str | None = None
    definitions: list[str] = field(default_factory=list)
    similar_words: list[str] = field(default_factory=list)
    near_antonyms: list[str] = field(default_factory=list)
    mnemonic: str | None = None
    example: str | None = None


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

        with open(path) as file:
            lines = [line.strip() for line in file.readlines() if line.strip()]

        word = Word(entry.text)

        for line in lines:
            if line[0] == "#":
                if line[1] == " " and line[2:].strip() != entry.text:
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
