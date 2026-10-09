# Words

A vocabulary trainer backed by an [Obsidian](https://obsidian.md) vault. The
original CLI quiz has been turned into a web application: a **FastAPI** backend
exposes the vault (Obsidian), the AI question generator (Ollama), and CRUD
operations as REST endpoints, while a plain **HTML/CSS/JS** frontend — served by
the same FastAPI process — runs the quiz logic in the browser.

## Features

- **Quiz** with three modes:
  - `similar` — pick the word similar to a given synonym
  - `classic` — pick the word matching a definition
  - `creative` — AI-generated fill-in-the-blank question (via Ollama)
- **Take** filters: all words, hard words, latest N, oldest N
- **Count** — how many words the `latest` / `oldest` take filters include
  (only shown for those two options)
- **Sampling**: uniform or exponential (latest / oldest)
- **Lexicon browser** with search and full word details
- **CRUD** for words (create, read, update, delete) writing back to the vault

## Quiz options

| Option       | Values                                              | Meaning                                                                 |
| ------------ | --------------------------------------------------- | ----------------------------------------------------------------------- |
| **Questions**| any positive integer                                | How many questions to ask (capped at the number of available words).    |
| **Mode**     | `similar`, `classic`, `creative`                    | How the question is built (see above).                                  |
| **Take**     | `all`, `hard`, `latest`, `oldest`                   | Which subset of words to draw from.                                     |
| **Count**    | any positive integer                                | For `latest` / `oldest` only: how many of the newest/oldest words to use.|
| **Sampling** | `uniform`, `latest`, `oldest`                       | Uniform picks evenly; exponential biases toward the newest/oldest words.|

The **Take** + **Count** pair replaces the original CLI's packed `-t` argument:
`-t l20` (latest 20) is now **Take = Latest N**, **Count = 20**; `-t o20`
(oldest 20) is **Take = Oldest N**, **Count = 20**.

## Requirements

- Python 3.11+
- (Optional) [Ollama](https://ollama.com) running locally on `http://localhost:11434`
  for `creative` mode. Without it, creative mode falls back to the definition.

## Setup

```bash
pip install -r requirements.txt
```

By default the app reads words from the `Lexicon/` folder next to `main.py`.
Override it with an environment variable:

```bash
export LEXICON_DIR=/path/to/your/vault/Lexicon
```

## Run

```bash
python main.py
```

Then open <http://127.0.0.1:8000>.

The API docs are available at <http://127.0.0.1:8000/docs>.

## API

| Method | Path                  | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| GET    | `/api/words`          | List all words (metadata)                |
| GET    | `/api/words/{text}`   | Get a single word                        |
| POST   | `/api/words`          | Create a word                            |
| PUT    | `/api/words/{text}`   | Update a word (renames file if needed)   |
| DELETE | `/api/words/{text}`   | Delete a word                            |
| GET    | `/api/quiz/pool`      | Full word data for the quiz              |
| POST   | `/api/quiz/question`  | Generate an AI question with Ollama      |

## Project layout

```
main.py            FastAPI app (API + static hosting)
obsidian.py        Vault reader/writer (Entry, Word, CRUD)
ollama.py          Ollama question generator
crandom.py         Random sampling helpers (reference)
quiz               Original CLI quiz (kept for reference)
static/            Frontend (index.html, styles.css, app.js)
Lexicon/           Word markdown files
```
