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
- **Answer review** — after answering, the correct answer is highlighted and you
  advance with a **Next** button (no auto-advance)
- **End-of-quiz report** — accuracy plus a list of every incorrect question with
  your answer, the correct answer, and a **Mark as hard** button
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

## Background Service (macOS)

### 1. Prerequisites

- macOS with `python3` (3.10+). Check with `python3 --version`.
- The repo cloned somewhere permanent. Moving it later breaks the service paths.
- A `requirements.txt` in the repo root that includes `fastapi` and `uvicorn`.

> **Tip:** Prefer a Python from python.org or `pyenv` rather than Homebrew. A Homebrew Python upgrade can break the venv.

### 2. Set variables

Run everything below in the same terminal session from the repo root. Adjust `APP_DIR` if needed.

```bash
cd /path/to/words-app          # <-- change to where you cloned the repo
export APP_DIR="$(pwd)"
export LABEL="com.biscuit.words-app"
export LOG_DIR="$HOME/Library/Logs/words-app"
export PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
```

### 3. Create the virtualenv and install dependencies

```bash
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"
```

Sanity check that the app runs (Ctrl+C to stop):

```bash
"$APP_DIR/.venv/bin/python" -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### 4. Create the log directory and log config

Logs are rotated by Python's `RotatingFileHandler`: 5 MB per file, 3 backups, oldest deleted automatically.

```bash
mkdir -p "$LOG_DIR"
python3 -m json.tool "$APP_DIR/log_config.json" >/dev/null && echo "log_config.json OK"
```

### 5. Create the launchd plist

```bash
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$APP_DIR/.venv/bin/python</string>
        <string>-m</string>
        <string>uvicorn</string>
        <string>main:app</string>
        <string>--host</string>
        <string>127.0.0.1</string>
        <string>--port</string>
        <string>8000</string>
        <string>--workers</string>
        <string>1</string>
        <string>--log-config</string>
        <string>$APP_DIR/log_config.json</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$APP_DIR</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>ProcessType</key>
    <string>Background</string>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/err.log</string>
</dict>
</plist>
EOF

chmod 644 "$PLIST"
plutil -lint "$PLIST"
```

`plutil` must print `OK` before you continue.

Notes:

- Keep `--workers 1`. `RotatingFileHandler` is not safe with multiple writer processes.
- If the app needs environment variables, add an `EnvironmentVariables` dict to the plist.
- `out.log` / `err.log` only capture startup crashes and stray prints; they stay tiny.

### 6. Add the zsh aliases

Append these to `~/.zshrc` (quoted heredoc, so nothing is expanded at write time):

```bash
cat >> ~/.zshrc <<'EOF'

# words-app service controls
alias words-status='launchctl print gui/$(id -u)/com.biscuit.words-app 2>/dev/null | grep -E "state|pid|last exit code" || echo "not loaded (stopped)"'
alias words-logs='tail -f ~/Library/Logs/words-app/app.log ~/Library/Logs/words-app/access.log'
alias words-restart='launchctl kickstart -k gui/$(id -u)/com.biscuit.words-app'
alias words-stop='launchctl bootout gui/$(id -u)/com.biscuit.words-app'
alias words-start='launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.biscuit.words-app.plist'
alias words-open='open http://127.0.0.1:8000'
EOF

source ~/.zshrc
```

| Alias | What it does |
|---|---|
| `words-status` | Show service state, PID, last exit code |
| `words-logs` | Follow app and access logs (Ctrl+C to exit) |
| `words-restart` | Kill and relaunch the service (use after code changes) |
| `words-stop` | Unload the service (stays off, even after next login) |
| `words-start` | Load and start the service |
| `words-open` | Open the app in the browser |

### 7. Start the service

```bash
launchctl bootstrap gui/$(id -u) "$PLIST"
```

If that fails with `Bootstrap failed: 5: Input/output error`, see [Troubleshooting](#troubleshooting). The fallback below usually works:

```bash
launchctl load -w "$PLIST"
```

Verify:

```bash
words-status
curl http://127.0.0.1:8000
tail ~/Library/Logs/words-app/app.log
```

The service will now start on every login.

### Uninstall

```bash
launchctl bootout gui/$(id -u)/com.biscuit.words-app
rm ~/Library/LaunchAgents/com.biscuit.words-app.plist
rm -rf ~/Library/Logs/words-app
```

Then remove the `# words-app service controls` block from `~/.zshrc`.
