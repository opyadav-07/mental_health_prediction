/* =========================================================
   MindMetrics – frontend logic (vanilla JS)
   Talks to the FastAPI backend: POST /predict
   ========================================================= */
"use strict";

const API_BASE_URL = "http://127.0.0.1:2200";
const REQUEST_TIMEOUT_MS = 15000;

/* ---------- Static option lists (mirror the Pydantic Literals) ---------- */
const PLATFORMS = [
  "Facebook", "LinkedIn", "Instagram", "Snapchat", "Twitter", "YouTube",
  "TikTok", "LINE", "KakaoTalk", "VKontakte", "WhatsApp", "WeChat",
];
// Countries the model knows individually; others are grouped to "Other" by the backend.
const COUNTRIES = [
  "India", "USA", "Canada", "Australia", "UK", "Germany", "Mexico", "Turkey", "France",
  "Brazil", "China", "Japan", "South Korea", "Russia", "Italy", "Spain", "Netherlands",
  "Sweden", "Norway", "Denmark", "Pakistan", "Bangladesh", "Nigeria", "South Africa",
  "Egypt", "Indonesia", "Philippines", "Vietnam", "Thailand", "Argentina", "Other",
];

/* ---------- Field rules (mirror the Pydantic constraints) ----------
   gt  = strictly greater than,  gte = greater or equal,  lte = less or equal   */
const RULES = {
  age:                     { label: "Age",                     type: "int",    gt: 10, lte: 100 },
  gender:                  { label: "Gender",                  type: "choice" },
  country:                 { label: "Country",                 type: "text" },
  academic_level:          { label: "Academic level",          type: "choice" },
  most_used_platform:      { label: "Most used platform",      type: "choice" },
  purpose_of_use:          { label: "Purpose of use",          type: "choice" },
  avg_daily_usage_hours:   { label: "Average daily usage",     type: "float",  gt: 0, lte: 24 },
  daily_unlocks:           { label: "Daily unlocks",           type: "int",    gt: 0 },
  study_hours:             { label: "Study hours",             type: "float",  gt: 0, lte: 24 },
  physical_activity_hours: { label: "Physical activity hours", type: "float",  gt: 0, lte: 24 },
  sleep_hours_per_night:   { label: "Sleep hours",             type: "float",  gt: 0, lte: 24 },
  stress_level:            { label: "Stress level",            type: "choice" },
};

const SAMPLE = {
  age: 21, gender: "Female", country: "India", academic_level: "Undergraduate",
  most_used_platform: "Instagram", purpose_of_use: "Entertainment",
  avg_daily_usage_hours: 4.5, daily_unlocks: 70, study_hours: 3,
  physical_activity_hours: 1, sleep_hours_per_night: 7, stress_level: "Medium",
};

/* ---------- DOM ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const form = $("#predictForm");
const submitBtn = $("#submitBtn");
const formError = $("#formError");
const resultCard = $("#resultCard");
const gaugeFill = $("#gaugeFill");
const GAUGE_CIRC = 2 * Math.PI * 84; // matches r=84 in the SVG

/* =========================================================
   Setup
   ========================================================= */
function init() {
  // Populate dynamic lists
  const platformSel = $("#most_used_platform");
  PLATFORMS.forEach((p) => platformSel.add(new Option(p, p)));
  const dl = $("#countryList");
  COUNTRIES.forEach((c) => dl.appendChild(new Option(c, c)));

  $("#apiUrlLabel").textContent = API_BASE_URL;
  gaugeFill.style.strokeDasharray = GAUGE_CIRC;
  gaugeFill.style.strokeDashoffset = GAUGE_CIRC;

  // Theme
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (_) {}
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  setTheme(saved || (prefersLight ? "light" : "dark"));
  $("#themeToggle").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });

  // Events
  form.addEventListener("submit", onSubmit);
  form.addEventListener("reset", onReset);
  $("#sampleBtn").addEventListener("click", fillSample);
  $("#retryBtn").addEventListener("click", () => form.requestSubmit());

  // Clear a field's error as soon as the user edits it
  form.addEventListener("input", (e) => clearFieldError(e.target.name));
  form.addEventListener("change", (e) => clearFieldError(e.target.name));

  checkApiStatus();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("theme", theme); } catch (_) {}
}

/* =========================================================
   API status ping (GET /)
   ========================================================= */
async function checkApiStatus() {
  const el = $("#apiStatus"), txt = $("#apiStatusText");
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/`, {}, 5000);
    if (!res.ok) throw new Error();
    el.className = "api-status online";
    txt.textContent = "API online";
  } catch (_) {
    el.className = "api-status offline";
    txt.textContent = "API offline";
  }
}

/* =========================================================
   Form helpers
   ========================================================= */
function readValue(name) {
  const els = form.elements[name];
  if (!els) return "";
  if (els instanceof RadioNodeList) return els.value;
  return els.value.trim();
}

function fieldWrap(name) { return form.querySelector(`.field[data-field="${name}"]`); }

function setFieldError(name, message) {
  const wrap = fieldWrap(name);
  if (!wrap) return false;
  wrap.classList.add("invalid");
  $(".error", wrap).textContent = message;
  return true;
}
function clearFieldError(name) {
  const wrap = name && fieldWrap(name);
  if (wrap) wrap.classList.remove("invalid");
}
function clearAllErrors() {
  form.querySelectorAll(".field.invalid").forEach((w) => w.classList.remove("invalid"));
  showFormError("");
}
function showFormError(message) {
  formError.hidden = !message;
  formError.textContent = message;
}

function fillSample() {
  clearAllErrors();
  Object.entries(SAMPLE).forEach(([name, val]) => {
    const el = form.elements[name];
    if (el instanceof RadioNodeList) el.value = val;
    else el.value = val;
  });
}

function onReset() {
  clearAllErrors();
  setState("idle");
  gaugeFill.style.strokeDashoffset = GAUGE_CIRC;
}

/* =========================================================
   Validation (client side, mirrors Pydantic)
   ========================================================= */
function validate() {
  const payload = {};
  const errors = {};

  for (const [name, rule] of Object.entries(RULES)) {
    const raw = readValue(name);

    if (raw === "") {
      errors[name] = rule.type === "choice" ? `Please choose ${rule.label.toLowerCase()}.` : `${rule.label} is required.`;
      continue;
    }

    if (rule.type === "choice" || rule.type === "text") {
      payload[name] = raw;
      continue;
    }

    const num = Number(raw);
    if (!Number.isFinite(num)) { errors[name] = `${rule.label} must be a number.`; continue; }
    if (rule.type === "int" && !Number.isInteger(num)) { errors[name] = `${rule.label} must be a whole number.`; continue; }
    if (rule.gt !== undefined && !(num > rule.gt)) { errors[name] = `${rule.label} must be greater than ${rule.gt}.`; continue; }
    if (rule.lte !== undefined && !(num <= rule.lte)) { errors[name] = `${rule.label} must be ${rule.lte} or less.`; continue; }

    payload[name] = num;
  }
  return { payload, errors };
}

/* =========================================================
   Submit → POST /predict
   ========================================================= */
async function onSubmit(e) {
  e.preventDefault();
  clearAllErrors();

  const { payload, errors } = validate();
  const names = Object.keys(errors);
  if (names.length) {
    names.forEach((n) => setFieldError(n, errors[n]));
    showFormError(`Please fix ${names.length} field${names.length > 1 ? "s" : ""} highlighted below.`);
    focusFirstInvalid();
    return;
  }

  setLoading(true);
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }, REQUEST_TIMEOUT_MS);

    const data = await res.json().catch(() => null);

    if (!res.ok) throw new ApiError(res.status, data);

    const score = data?.predicted_mental_health_score;
    if (typeof score !== "number") throw new Error("The server returned an unexpected response.");

    showResult(score);
    markApiOnline(true);
  } catch (err) {
    handleError(err);
  } finally {
    setLoading(false);
  }
}

class ApiError extends Error {
  constructor(status, body) { super(`HTTP ${status}`); this.status = status; this.body = body; }
}

function fetchWithTimeout(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function markApiOnline(ok) {
  $("#apiStatus").className = `api-status ${ok ? "online" : "offline"}`;
  $("#apiStatusText").textContent = ok ? "API online" : "API offline";
}

/* =========================================================
   Error handling
   ========================================================= */
function handleError(err) {
  let title = "Something went wrong";
  let message = "Unexpected error. Please try again.";

  if (err instanceof ApiError) {
    if (err.status === 422 && Array.isArray(err.body?.detail)) {
      // FastAPI validation errors → map to fields
      const unmapped = [];
      err.body.detail.forEach((d) => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
        const msg = humanizeValidation(d);
        if (!(typeof field === "string" && setFieldError(field, msg))) unmapped.push(msg);
      });
      title = "Please check your inputs";
      message = unmapped.length ? unmapped.join(" ") : "The server rejected some values. See the highlighted fields.";
      showFormError("The server rejected some values. See the highlighted fields.");
      focusFirstInvalid();
    } else if (err.status >= 500) {
      title = "Server error";
      message = "The prediction service hit an internal error. Check the FastAPI console for details, then try again.";
    } else {
      title = `Request failed (${err.status})`;
      message = typeof err.body?.detail === "string" ? err.body.detail : "The server could not process this request.";
    }
  } else if (err.name === "AbortError") {
    title = "Request timed out";
    message = "The server took too long to respond. Please try again.";
  } else if (err instanceof TypeError) {
    // fetch() network failure
    title = "Can't reach the API";
    message = `Make sure the backend is running:  uvicorn main:app --port 2200 --reload  (${API_BASE_URL})`;
    markApiOnline(false);
  } else if (err.message) {
    message = err.message;
  }

  $("#errTitle").textContent = title;
  $("#errMessage").textContent = message;
  setState("error");
  resultCard.classList.remove("shake"); void resultCard.offsetWidth; resultCard.classList.add("shake");
  scrollToResultOnMobile();
}

function humanizeValidation(d) {
  const field = Array.isArray(d.loc) ? String(d.loc[d.loc.length - 1]) : "";
  const label = RULES[field]?.label || field || "Value";
  switch (d.type) {
    case "missing": return `${label} is required.`;
    case "greater_than": return `${label} must be greater than ${d.ctx?.gt}.`;
    case "less_than_equal": return `${label} must be ${d.ctx?.le} or less.`;
    case "int_parsing": case "int_from_float": return `${label} must be a whole number.`;
    case "float_parsing": return `${label} must be a number.`;
    case "literal_error": return `${label}: ${d.msg.replace(/^Input should be /, "choose ")}.`;
    default: return `${label}: ${d.msg}`;
  }
}

function focusFirstInvalid() {
  const first = form.querySelector(".field.invalid");
  if (!first) return;
  first.scrollIntoView({ behavior: "smooth", block: "center" });
  first.querySelector("input, select")?.focus({ preventScroll: true });
}

/* =========================================================
   UI states
   ========================================================= */
function setState(state) { resultCard.dataset.state = state; }

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  $(".btn-label", submitBtn).textContent = on ? "Predicting…" : "Predict score";
  if (on) { setState("loading"); scrollToResultOnMobile(); }
}

function scrollToResultOnMobile() {
  if (window.matchMedia("(max-width: 920px)").matches) {
    resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/* =========================================================
   Result card
   Assumes the score is on a 0–10 scale (higher = better wellbeing).
   ========================================================= */
const BANDS = [
  { min: 8, band: "great", label: "Excellent", text: "This profile points to strong mental wellbeing. Keep up the balanced habits." },
  { min: 6, band: "good",  label: "Good",      text: "Generally healthy. A few small habit tweaks could push this even higher." },
  { min: 4, band: "mid",   label: "Moderate",  text: "Some signs of strain. Consider less screen time and more sleep or movement." },
  { min: -Infinity, band: "low", label: "Needs attention", text: "This profile suggests elevated risk. Reducing usage and seeking support may help." },
];

function showResult(score) {
  const info = BANDS.find((b) => score >= b.min);
  resultCard.dataset.band = info.band;
  $("#scoreBadge").textContent = info.label;
  $("#scoreVerdict").textContent = info.text;
  setState("success");

  // Reset, then animate gauge + number
  gaugeFill.style.transition = "none";
  gaugeFill.style.strokeDashoffset = GAUGE_CIRC;
  void gaugeFill.getBoundingClientRect();
  gaugeFill.style.transition = "";
  const pct = Math.min(Math.max(score / 10, 0), 1);
  requestAnimationFrame(() => { gaugeFill.style.strokeDashoffset = GAUGE_CIRC * (1 - pct); });

  countUp($("#scoreValue"), score, 1200);
  scrollToResultOnMobile();
}

function countUp(el, target, duration) {
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  (function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = (target * ease(t)).toFixed(2);
    if (t < 1) requestAnimationFrame(frame);
  })(start);
}

document.addEventListener("DOMContentLoaded", init);
