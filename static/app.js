/* ==========================================================================
 * Words · front-end quiz + lexicon client
 * Quiz logic lives here; data & CRUD live in the FastAPI backend.
 * ========================================================================== */

const API = "/api";

/* ----------------------------- Utilities ------------------------------ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(message, kind = "") {
  const el = $("#toast");
  el.textContent = message;
  el.className = "toast " + kind;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* --------------------------- Random helpers --------------------------- */
// Weighted random index (mirrors crandom.rand)
function rand(n, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let cumulative = 0;
  for (let i = 0; i < n; i++) {
    cumulative += weights[i];
    if (r <= cumulative) return i;
  }
  return n - 1;
}

// Exponential sampling (mirrors crandom.randexp)
function randexp(n, lam = 1.0) {
  if (n === 0) throw new Error("n cannot be zero");
  if (n === 1) return 0;
  const weights = [];
  for (let i = 0; i < n; i++) weights.push(Math.exp((lam * i) / (n - 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let cumulative = 0;
  for (let i = 0; i < n; i++) {
    cumulative += weights[i];
    if (r <= cumulative) return i;
  }
  return n - 1;
}

// Build the 5 answer choices (mirrors quiz.select_choices)
function selectChoices(wordBank, answer, weights) {
  const i = wordBank.indexOf(answer);
  if (i >= 0) weights[i] = Math.max(weights[i] / 10, 0);

  const keys = ["a", "b", "c", "d", "e"];
  const correctKey = keys[Math.floor(Math.random() * keys.length)];
  const choices = [];

  for (const key of keys) {
    if (key === correctKey) {
      choices.push(answer);
    } else {
      let guard = 0;
      while (guard++ < 1000) {
        const idx = rand(wordBank.length, weights);
        const candidate = wordBank[idx];
        if (candidate !== answer && !choices.includes(candidate)) {
          choices.push(candidate);
          weights[idx] = Math.max(weights[idx] / 10, 0);
          break;
        }
      }
    }
  }
  return choices;
}

/* ------------------------------ State --------------------------------- */
const state = {
  pool: [], // full word objects from /api/quiz/pool
  quiz: null, // active quiz session
  lexicon: [], // word metadata list
  matches: [], // current search results shown in the sidebar dropdown
  selected: null, // selected word text in lexicon
  editing: null, // word text being edited in the modal (null = creating)
  resultsHidden: false, // dropdown suppressed after a selection or blur
  focusIdx: 0, // keyboard-highlighted search result
};

/* ============================== QUIZ ================================== */
function applyTake(pool, take, count) {
  if (take === "all") return pool.slice();
  if (take === "hard") return pool.filter((w) => w.marked_as_hard);

  const sorted = pool.slice().sort((a, b) => a.ctime - b.ctime);
  if (take === "latest") return sorted.slice(-count);
  if (take === "oldest") return sorted.slice(0, count);
  return pool.slice();
}

function applySamplingOrder(pool, sampling) {
  if (sampling === "latest") return pool.slice().sort((a, b) => a.ctime - b.ctime);
  if (sampling === "oldest") return pool.slice().sort((a, b) => b.ctime - a.ctime);
  return pool.slice();
}

async function startQuiz() {
  const no = parseInt($("#opt-no").value, 10);
  const mode = $("#opt-mode").value;
  const take = $("#opt-take").value;
  const takeCount = parseInt($("#opt-take-count").value, 10) || 0;
  const sampling = $("#opt-sampling").value;

  if (!state.pool.length) {
    toast("No words available to quiz.", "bad");
    return;
  }

  let entries = applyTake(state.pool, take, takeCount);
  if (!entries.length) {
    toast("No words match the selected filter.", "bad");
    return;
  }

  const total = Math.min(no, entries.length);
  entries = applySamplingOrder(entries, sampling);

  state.quiz = {
    mode,
    sampling,
    total,
    current: 0,
    correct: 0,
    entries,
    wordBank: state.pool.map((w) => w.text),
    weights: state.pool.map(() => 100.0),
    answered: false,
    results: [],
  };

  $("#quiz-setup").hidden = true;
  $("#quiz-result").hidden = true;
  $("#quiz-panel").hidden = false;
  nextQuestion();
}

async function nextQuestion() {
  const quiz = state.quiz;
  if (!quiz) return;

  if (quiz.current >= quiz.total || quiz.entries.length === 0) {
    return finishQuiz();
  }

  // Pick an entry
  let idx;
  if (quiz.sampling === "uniform") {
    idx = Math.floor(Math.random() * quiz.entries.length);
  } else {
    idx = randexp(quiz.entries.length, 3);
  }
  const word = quiz.entries[idx];
  quiz.entries.splice(idx, 1);

  const definition = word.definitions[Math.floor(Math.random() * word.definitions.length)];

  // Build the question text
  let question;
  if (quiz.mode === "classic") {
    question = definition;
  } else if (quiz.mode === "similar") {
    if (word.similar_words && word.similar_words.length) {
      const similar = word.similar_words[Math.floor(Math.random() * word.similar_words.length)];
      question = `Choose the word which is similar to "${similar}":`;
    } else {
      question = definition;
    }
  } else {
    // creative mode → ask the backend / Ollama
    question = definition;
    renderQuestion(question, null, true);
    try {
      const res = await api("/quiz/question", {
        method: "POST",
        body: JSON.stringify({ word: word.text, definitions: word.definitions }),
      });
      question = res.question;
    } catch (err) {
      toast("AI question failed, using definition.", "bad");
    }
  }

  const choices = selectChoices(quiz.wordBank, word.text, quiz.weights);

  quiz.answered = false;
  quiz.currentWord = word;
  quiz.currentDefinition = definition;
  quiz.currentQuestion = question;
  quiz.currentChoices = choices;
  renderQuestion(question, choices, false);
}

function renderQuestion(question, choices, thinking) {
  const quiz = state.quiz;
  $("#quiz-progress").textContent = `${quiz.current + 1} of ${quiz.total}`;
  $("#progress-fill").style.width = `${(quiz.current / quiz.total) * 100}%`;
  $("#question-text").textContent = thinking ? "Thinking…" : question;
  $("#feedback").textContent = "";
  $("#feedback").className = "feedback";
  $("#hint-box").hidden = true;
  $("#quiz-next").hidden = true;

  const container = $("#choices");
  container.innerHTML = "";

  if (thinking || !choices) return;

  const keys = ["A", "B", "C", "D", "E"];
  choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.innerHTML = `<span class="key">${keys[i]}</span><span>${choice}</span>`;
    btn.addEventListener("click", (e) =>
      answerQuestion(choice, btn, e.detail === 0)
    );
    container.appendChild(btn);
  });
}

function answerQuestion(choice, btn, fromKeyboard = false) {
  const quiz = state.quiz;
  if (quiz.answered) return;
  quiz.answered = true;

  const correct = choice === quiz.currentWord.text;
  const buttons = $$("#choices .choice");
  buttons.forEach((b) => {
    b.disabled = true;
    const label = b.querySelector("span:last-child").textContent;
    if (label === quiz.currentWord.text) b.classList.add("correct");
  });

  const feedback = $("#feedback");
  if (correct) {
    quiz.correct++;
    feedback.textContent = "✓ Correct";
    feedback.className = "feedback good";
  } else {
    btn.classList.add("wrong");
    feedback.textContent = `✗ Incorrect — the correct answer is "${quiz.currentWord.text}"`;
    feedback.className = "feedback bad";
  }

  // Record the answer for the end-of-quiz report
  quiz.results.push({
    word: quiz.currentWord,
    question: quiz.currentQuestion,
    chosen: choice,
    correct: quiz.currentWord.text,
    isCorrect: correct,
  });

  quiz.current++;
  $("#progress-fill").style.width = `${(quiz.current / quiz.total) * 100}%`;

  // Wait for the user to continue instead of auto-advancing
  const nextBtn = $("#btn-next");
  nextBtn.textContent =
    quiz.current >= quiz.total ? "See results →" : "Next question →";
  $("#quiz-next").hidden = false;
  // Only steal focus when the answer came from the keyboard; focusing on a
  // mouse click would show a focus ring the user did not ask for.
  if (fromKeyboard) nextBtn.focus();
}

function finishQuiz() {
  const quiz = state.quiz;
  const pct = quiz.total ? Math.round((quiz.correct / quiz.total) * 100) : 0;

  $("#quiz-panel").hidden = true;
  $("#quiz-result").hidden = false;
  $("#score-value").textContent = `${pct}%`;
  $("#score-ring").style.setProperty("--pct", `${pct}%`);
  $("#result-line").textContent = `You answered ${quiz.correct} of ${quiz.total} correctly.`;
  renderReport(quiz.results);
  state.quiz = null;
}

/* --------------------------- Quiz report ------------------------------ */
function renderReport(results) {
  const container = $("#report");
  const wrong = results.filter((r) => !r.isCorrect);

  if (!wrong.length) {
    container.innerHTML = `<p class="report-empty">Perfect score — nothing to review. 🎉</p>`;
    return;
  }

  container.innerHTML = `
    <div class="report-head">
      <h3>Review (${wrong.length} incorrect)</h3>
    </div>
    <ul class="report-list"></ul>
  `;

  const list = container.querySelector(".report-list");
  wrong.forEach((r) => {
    const li = document.createElement("li");
    li.className = "report-item";
    li.innerHTML = `
      <div class="report-q">${r.question}</div>
      <div class="report-answers">
        <span class="report-answer bad">
          <span class="report-label">Your answer</span>${r.chosen}
        </span>
        <span class="report-answer good">
          <span class="report-label">Correct</span>${r.correct}
        </span>
      </div>
      <div class="report-actions"></div>
    `;

    const actions = li.querySelector(".report-actions");
    const hardBtn = document.createElement("button");
    hardBtn.className = "btn ghost small";
    hardBtn.textContent = r.word.marked_as_hard ? "Marked as hard" : "Mark as hard";
    hardBtn.disabled = r.word.marked_as_hard;
    hardBtn.addEventListener("click", () => markAsHard(r.word, hardBtn));
    actions.appendChild(hardBtn);

    list.appendChild(li);
  });
}

async function markAsHard(word, btn) {
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const payload = { ...word, marked_as_hard: true };
    delete payload.ctime;
    delete payload.mtime;
    await api(`/words/${encodeURIComponent(word.text)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    word.marked_as_hard = true;
    btn.textContent = "Marked as hard";
    toast(`"${word.text}" marked as hard.`, "good");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Mark as hard";
    toast(err.message, "bad");
  }
}

function quitQuiz() {
  state.quiz = null;
  $("#quiz-panel").hidden = true;
  $("#quiz-result").hidden = true;
  $("#quiz-setup").hidden = false;
}

function showHint() {
  const quiz = state.quiz;
  if (!quiz || !quiz.currentDefinition) return;
  const box = $("#hint-box");
  box.textContent = `Hint: ${quiz.currentDefinition}`;
  box.hidden = false;
}

/* ============================ LEXICON ================================= */
const LEXICON_OPEN_KEY = "words.lexiconOpen";

function lexiconIsOpen() {
  return !$("#lexicon-sidebar").hidden;
}

function setSidebar(open) {
  const sidebar = $("#lexicon-sidebar");
  const scrim = $("#sidebar-scrim");
  const toggle = $("#btn-toggle-sidebar");

  sidebar.hidden = !open;
  scrim.hidden = !open;
  toggle.classList.toggle("active", open);
  toggle.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("lexicon-open", open);

  try {
    localStorage.setItem(LEXICON_OPEN_KEY, open ? "1" : "0");
  } catch (_) {
    /* private mode — persistence is optional */
  }

  if (open) {
    loadLexicon();
  } else {
    hideResults();
    $("#search").blur();
  }
}

function openSidebar() {
  if (!lexiconIsOpen()) setSidebar(true);
}

function closeSidebar() {
  if (lexiconIsOpen()) setSidebar(false);
}

function toggleSidebar() {
  setSidebar(!lexiconIsOpen());
}

function focusSearch() {
  openSidebar();
  const input = $("#search");
  input.focus();
  input.select();
}

async function loadLexicon() {
  try {
    state.lexicon = await api("/words");
    renderWordList();
  } catch (err) {
    toast("Failed to load dictionary: " + err.message, "bad");
  }
}

/* The results dropdown is visible while the sidebar is open and the user has
   not just picked a word (choosing one, or blurring the search box, closes
   it again). */
function resultsVisible() {
  return lexiconIsOpen() && !state.resultsHidden;
}

function hideResults() {
  state.resultsHidden = true;
  $("#word-list").hidden = true;
  $("#search").setAttribute("aria-expanded", "false");
}

function showResults() {
  state.resultsHidden = false;
  renderWordList();
}

function renderWordList() {
  const input = $("#search");
  const query = input.value.trim().toLowerCase();
  const list = $("#word-list");
  list.innerHTML = "";

  $("#search-clear").hidden = !query;
  input.closest(".search-field").classList.toggle("has-query", !!query);

  state.matches = state.lexicon.filter((w) => w.text.toLowerCase().includes(query));

  if (!state.matches.length) {
    list.innerHTML = `<li class="no-results">No words found.</li>`;
  }

  state.focusIdx = Math.min(state.focusIdx, Math.max(state.matches.length - 1, 0));

  state.matches.forEach((entry, i) => {
    const li = document.createElement("li");
    li.dataset.text = entry.text;
    li.setAttribute("role", "option");
    if (state.selected === entry.text) li.classList.add("active");
    if (i === state.focusIdx) li.classList.add("focused");
    li.innerHTML = `<span>${entry.text}</span>${
      entry.marked_as_hard ? '<span class="badge-hard">hard</span>' : ""
    }`;
    // mousedown (not click) so blur does not close the list first
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectWord(entry.text);
    });
    list.appendChild(li);
  });

  const visible = resultsVisible();
  list.hidden = !visible;
  $("#search").setAttribute("aria-expanded", String(visible));
}

function moveFocus(delta) {
  if (!state.matches.length) return;
  state.focusIdx = (state.focusIdx + delta + state.matches.length) % state.matches.length;
  state.resultsHidden = false;
  renderWordList();
}

/* Enter in the search box opens the details of the highlighted (default:
   first) result. */
function selectFocusedResult() {
  if (!state.matches.length) return;
  const entry = state.matches[state.focusIdx] || state.matches[0];
  selectWord(entry.text);
}

async function selectWord(text) {
  state.selected = text;
  hideResults();
  renderWordList();
  const detail = $("#word-detail");
  detail.innerHTML = `<p class="empty">Loading…</p>`;
  try {
    const word = await api(`/words/${encodeURIComponent(text)}`);
    renderWordDetail(word);
  } catch (err) {
    detail.innerHTML = `<p class="empty">Failed to load: ${err.message}</p>`;
  }
}

function renderWordDetail(word) {
  const detail = $("#word-detail");
  const chips = (arr) =>
    arr && arr.length
      ? `<div class="chips">${arr.map((w) => `<span class="chip">${w}</span>`).join("")}</div>`
      : "";

  detail.innerHTML = `
    <h3>${word.text} ${word.marked_as_hard ? '<span class="badge-hard">hard</span>' : ""}</h3>
    ${word.pronunciation ? `<div class="pron">${word.pronunciation}</div>` : ""}
    ${
      word.definitions.length
        ? `<div class="section"><h4>Definitions</h4><ul>${word.definitions
            .map((d) => `<li>${d}</li>`)
            .join("")}</ul></div>`
        : ""
    }
    ${
      word.similar_words.length
        ? `<div class="section"><h4>Similar words</h4>${chips(word.similar_words)}</div>`
        : ""
    }
    ${
      word.near_antonyms.length
        ? `<div class="section"><h4>Near antonyms</h4>${chips(word.near_antonyms)}</div>`
        : ""
    }
    ${word.mnemonic ? `<div class="section"><h4>Mnemonic</h4><p>${word.mnemonic}</p></div>` : ""}
    ${word.example ? `<div class="section"><h4>Example</h4><p>${word.example}</p></div>` : ""}
    <div class="detail-actions">
      <button class="btn ghost" id="btn-edit">Edit</button>
      <button class="btn danger" id="btn-delete">Delete</button>
    </div>
  `;

  $("#btn-edit").addEventListener("click", () => editWordInPlace(word));
  $("#btn-delete").addEventListener("click", () => deleteWord(word.text));
}

function detailEmpty() {
  $("#word-detail").innerHTML =
    `<p class="empty">Select a word to view its details.</p>`;
}

/* --------------------------- In-place editing -------------------------- */
/* Definitions/similar words/antonyms are edited as plain text (one
   definition per line, the rest comma separated) and split back on save. */
function fieldMarkup(label, name, { multiline = false, rows = 3 } = {}) {
  if (multiline) {
    return `<label class="field"><span>${label}</span>
      <textarea data-field="${name}" rows="${rows}"></textarea></label>`;
  }
  return `<label class="field"><span>${label}</span>
    <input type="text" data-field="${name}" /></label>`;
}

function fillEditor(root, word) {
  const set = (name, value) => {
    const el = root.querySelector(`[data-field="${name}"]`);
    if (el) el.value = value;
  };
  set("text", word.text);
  set("pronunciation", word.pronunciation || "");
  set("definitions", word.definitions.join("\n"));
  set("similar", word.similar_words.join(", "));
  set("antonyms", word.near_antonyms.join(", "));
  set("mnemonic", word.mnemonic || "");
  set("example", word.example || "");
  const hard = root.querySelector('[data-field="hard"]');
  if (hard) hard.checked = word.marked_as_hard;
}

function editWordInPlace(word) {
  const detail = $("#word-detail");
  detail.innerHTML = `
    <form class="word-form" id="detail-form">
      ${fieldMarkup("Word", "text")}
      ${fieldMarkup("Pronunciation", "pronunciation")}
      ${fieldMarkup("Definitions (one per line)", "definitions", { multiline: true, rows: 4 })}
      ${fieldMarkup("Similar words (comma separated)", "similar")}
      ${fieldMarkup("Near antonyms (comma separated)", "antonyms")}
      ${fieldMarkup("Mnemonic", "mnemonic")}
      ${fieldMarkup("Example", "example", { multiline: true, rows: 2 })}
      <label class="checkbox">
        <input type="checkbox" data-field="hard" />
        <span>Mark as hard</span>
      </label>
      <div class="word-form-actions">
        <button type="button" class="btn ghost" id="btn-edit-cancel">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
  `;

  const form = $("#detail-form");
  fillEditor(form, word);
  form.querySelector('[data-field="text"]').focus();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    saveWordFrom(form, word.text);
  });
  $("#btn-edit-cancel").addEventListener("click", () => renderWordDetail(word));
}

function readForm(root) {
  const value = (name) => root.querySelector(`[data-field="${name}"]`)?.value ?? "";
  return {
    text: value("text").trim(),
    pronunciation: value("pronunciation").trim() || null,
    definitions: value("definitions")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    similar_words: splitList(value("similar")),
    near_antonyms: splitList(value("antonyms")),
    mnemonic: value("mnemonic").trim() || null,
    example: value("example").trim() || null,
    marked_as_hard: !!root.querySelector('[data-field="hard"]')?.checked,
  };
}

async function saveWordFrom(root, editing) {
  const payload = readForm(root);
  if (!payload.text) {
    toast("Word text is required.", "bad");
    return false;
  }

  try {
    if (editing) {
      await api(`/words/${encodeURIComponent(editing)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      toast("Word updated.", "good");
    } else {
      await api("/words", { method: "POST", body: JSON.stringify(payload) });
      toast("Word created.", "good");
    }
    await loadLexicon();
    await refreshPool();
    await selectWord(payload.text);
    return true;
  } catch (err) {
    toast(err.message, "bad");
    return false;
  }
}

/* ------------------------------ Modal --------------------------------- */
function openModal(word = null) {
  state.editing = word ? word.text : null;
  $("#modal-title").textContent = word ? "Edit word" : "New word";
  const form = $("#word-form");
  if (word) fillEditor(form, word);
  else form.reset();
  $("#modal-backdrop").hidden = false;
  form.querySelector('[data-field="text"]').focus();
}

function closeModal() {
  $("#modal-backdrop").hidden = true;
  state.editing = null;
}

function splitList(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function deleteWord(text) {
  if (!confirm(`Delete "${text}"? This cannot be undone.`)) return;
  try {
    await api(`/words/${encodeURIComponent(text)}`, { method: "DELETE" });
    toast("Word deleted.", "good");
    state.selected = null;
    detailEmpty();
    await loadLexicon();
    await refreshPool();
  } catch (err) {
    toast(err.message, "bad");
  }
}

/* ------------------------------ Pool ---------------------------------- */
async function refreshPool() {
  try {
    state.pool = await api("/quiz/pool");
    $("#pool-info").textContent = `${state.pool.length} words available`;
  } catch (err) {
    $("#pool-info").textContent = "Failed to load words";
  }
}

/* --------------------------- Custom select ---------------------------- */
/* Enhances each native <select> with a styled listbox. The native element
   stays in the DOM (hidden) so `.value` and `change` events keep working. */
function enhanceSelect(root) {
  const native = root.querySelector("select");
  const trigger = root.querySelector(".select-trigger");
  const valueEl = root.querySelector(".select-value");
  const menu = root.querySelector(".select-menu");

  const options = Array.from(native.options);
  let focused = native.selectedIndex;

  // Build the listbox items once
  options.forEach((opt, i) => {
    const li = document.createElement("li");
    li.className = "select-option";
    li.setAttribute("role", "option");
    li.dataset.index = i;
    li.textContent = opt.textContent;
    li.addEventListener("click", () => choose(i));
    menu.appendChild(li);
  });

  function syncLabel() {
    valueEl.textContent = options[native.selectedIndex]?.textContent || "";
    Array.from(menu.children).forEach((li, i) =>
      li.setAttribute("aria-selected", String(i === native.selectedIndex))
    );
  }

  function open() {
    closeAllSelects(root);
    focused = native.selectedIndex;
    root.classList.add("open");
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    highlight();
  }

  function close() {
    root.classList.remove("open");
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  function highlight() {
    Array.from(menu.children).forEach((li, i) =>
      li.classList.toggle("focused", i === focused)
    );
    menu.children[focused]?.scrollIntoView({ block: "nearest" });
  }

  function choose(i) {
    native.selectedIndex = i;
    native.dispatchEvent(new Event("change", { bubbles: true }));
    syncLabel();
    close();
    trigger.focus();
  }

  trigger.addEventListener("click", () => (root.classList.contains("open") ? close() : open()));

  trigger.addEventListener("keydown", (e) => {
    const isOpen = root.classList.contains("open");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) return open();
      focused = Math.min(Math.max(focused + (e.key === "ArrowDown" ? 1 : -1), 0), options.length - 1);
      highlight();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (isOpen) choose(focused);
      else open();
    } else if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      close();
    }
  });

  root._closeSelect = close;
  syncLabel();
}

function closeAllSelects(except) {
  $$("[data-select]").forEach((root) => {
    if (root !== except && root._closeSelect) root._closeSelect();
  });
}

/* ------------------------------ Wiring -------------------------------- */
function isTextField(el) {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

function modalIsOpen() {
  return !$("#modal-backdrop").hidden;
}

function init() {
  // Custom selects
  $$("[data-select]").forEach(enhanceSelect);
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-select]")) closeAllSelects();
  });

  // Quiz setup
  $("#opt-take").addEventListener("change", (e) => {
    $("#take-count-field").hidden = !["latest", "oldest"].includes(e.target.value);
  });
  $("#btn-start").addEventListener("click", startQuiz);
  $("#btn-again").addEventListener("click", () => {
    $("#quiz-result").hidden = true;
    $("#quiz-setup").hidden = false;
  });
  $("#btn-quit").addEventListener("click", quitQuiz);
  $("#btn-hint").addEventListener("click", showHint);
  $("#btn-next").addEventListener("click", () => {
    const quiz = state.quiz;
    if (!quiz) return;
    if (quiz.current >= quiz.total) finishQuiz();
    else nextQuestion();
  });

  // Lexicon sidebar
  $("#btn-toggle-sidebar").addEventListener("click", toggleSidebar);
  $("#sidebar-scrim").addEventListener("click", closeSidebar);
  $("#btn-new-word").addEventListener("click", () => openModal(null));

  const search = $("#search");
  search.addEventListener("input", showResults);
  search.addEventListener("focus", () => {
    state.focusIdx = 0;
    showResults();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectFocusedResult();
    }
  });

  $("#search-clear").addEventListener("click", () => {
    search.value = "";
    state.focusIdx = 0;
    showResults();
    search.focus();
  });

  // Click-away closes the dropdown without losing the detail pane
  document.addEventListener("mousedown", (e) => {
    if (!lexiconIsOpen() || state.resultsHidden) return;
    if (!e.target.closest(".lexicon-search")) hideResults();
  });

  // Modal
  $("#modal-close").addEventListener("click", closeModal);
  $("#btn-cancel").addEventListener("click", closeModal);
  $("#word-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const editing = state.editing;
    saveWordFrom(e.currentTarget, editing).then((ok) => {
      if (ok) closeModal();
    });
  });
  $("#modal-backdrop").addEventListener("click", (e) => {
    if (e.target === $("#modal-backdrop")) closeModal();
  });

  // Restore the sidebar state from the previous visit
  let open = false;
  try {
    open = localStorage.getItem(LEXICON_OPEN_KEY) === "1";
  } catch (_) {
    /* ignore */
  }
  if (open) {
    setSidebar(true);
    state.resultsHidden = true; // keep the dropdown closed until asked for
  }

  // Global keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllSelects();
      if (modalIsOpen()) {
        closeModal();
      } else if (lexiconIsOpen()) {
        // Esc always hides the lexicon, whatever the search dropdown is doing
        e.preventDefault();
        closeSidebar();
      }
      return;
    }

    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // "/" focuses the lexicon search (opening the sidebar if needed)
    if (e.key === "/" && !isTextField(e.target) && !modalIsOpen()) {
      e.preventDefault();
      focusSearch();
      return;
    }

    // "\" toggles the sidebar, unless the user is typing
    if (e.key === "\\" && !isTextField(e.target) && !modalIsOpen()) {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Quiz shortcuts must not fire while typing in a text field
    if (isTextField(e.target) || modalIsOpen()) return;
    if (!state.quiz) return;

    const key = e.key.toLowerCase();

    // "h" hints and "q" quits — available before and after answering
    if (key === "h") {
      e.preventDefault();
      showHint();
      return;
    }
    if (key === "q") {
      e.preventDefault();
      quitQuiz();
      return;
    }

    // Once answered, Enter/Space advances to the next question
    if (state.quiz.answered) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        $("#btn-next").click();
      }
      return;
    }

    const map = { a: 0, b: 1, c: 2, d: 3, e: 4 };
    if (key in map) {
      const btn = $$("#choices .choice")[map[key]];
      if (btn) btn.click();
    }
  });

  refreshPool();
}

document.addEventListener("DOMContentLoaded", init);
