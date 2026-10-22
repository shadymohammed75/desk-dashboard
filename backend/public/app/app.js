// Gym Log — phone app for the desk dashboard. Plain JS, no build step.
// All logic (status, score, XP, streak) lives on the server; this app logs and displays.
"use strict";

// ---------------------------------------------------------------- constants

const TOKEN_KEY = "gymlog.token";
const TAB_KEY = "gymlog.tab";

const MUSCLE_NAMES = {
  chest: "Chest", front_delts: "Front delts", side_delts: "Side delts", rear_delts: "Rear delts",
  biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", abs: "Abs", obliques: "Obliques",
  traps: "Traps", upper_back: "Upper back", lats: "Lats", lower_back: "Lower back",
  glutes: "Glutes", quads: "Quads", hamstrings: "Hamstrings", calves: "Calves",
};
const MUSCLE_ORDER = Object.keys(MUSCLE_NAMES);
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const GOAL_FIELDS = [
  ["steps", "Steps"], ["active_kcal", "Active kcal"], ["kcal", "Food kcal"],
  ["protein_g", "Protein g"], ["sleep_min", "Sleep min"], ["gym_per_week", "Gym / week"],
];

// Small original line icons (24×24, stroke = currentColor).
const ICONS = {
  today: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  plan: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6M12 8v4l3 2"/>',
  flame: '<path d="M12 21c-3.9 0-6-2.6-6-5.6 0-3.6 3-5.4 3.6-8.4 2.4 1.2 3.4 3.4 3.2 5.2 1-.6 1.7-1.8 1.8-3 1.8 1.6 3.4 3.6 3.4 6.2 0 3-2.1 5.6-6 5.6z"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------------------------------------------------------------- tiny DOM helper (never uses innerHTML for data)

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // only ever used with our own static icon markup
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------------------------------------------------------------- storage (Safari private mode can throw)

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* memory only */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------- state

const S = {
  token: store.get(TOKEN_KEY),
  tab: store.get(TAB_KEY) || "today",
  today: null,      // GET /api/today
  config: null,     // GET /api/config
  history: null,    // GET /api/history
  sheet: null,      // "I trained" sheet state
  loginError: null,
  bodySvg: null,    // parsed body.svg (cloned per render)
  planDraft: null,
  sweepUntil: 0,    // play the bottom-to-top "done" sweep until this time
  bpDraft: null,    // BP form values, kept across re-renders
};

// ---------------------------------------------------------------- API

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${S.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "No connection. Try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout("Your token was rejected. Enter it again.");
    throw new ApiError(401, "Token rejected");
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `Server error (${res.status})`);
  return data;
}

async function loadToday() { S.today = await api("GET", "/api/today"); }
async function loadConfig() { S.config = await api("GET", "/api/config"); }
async function loadHistory() { S.history = await api("GET", "/api/history?days=14"); }

async function loadBody() {
  if (S.bodySvg) return;
  try {
    // Drop the SVG's own <style> before parsing: app.css styles it, and the strict CSP would refuse it.
    const text = (await (await fetch("body.svg")).text()).replace(/<style[\s\S]*?<\/style>/, "");
    S.bodySvg = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
  } catch {
    S.bodySvg = null;
  }
}

function logout(message) {
  store.del(TOKEN_KEY);
  S.token = null;
  S.today = S.config = S.history = null;
  S.loginError = message || null;
  render();
}

// ---------------------------------------------------------------- feedback

let toastTimer;
function toast(message, ok = false) {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: `toast${ok ? " ok" : ""}`, role: "status" }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

function celebrate(title, sub) {
  const colors = ["#FF6A1A", "#3DFF8F", "#FFC53D", "#22D3EE"];
  const layer = h("div", { class: "celebrate", "aria-hidden": "true" });
  for (let i = 0; i < 34; i++) {
    const c = h("i", { class: "confetti" });
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % 4];
    c.style.animationDelay = `${Math.random() * 0.35}s`;
    c.style.setProperty("--dx", `${(Math.random() - 0.5) * 120}px`);
    c.style.setProperty("--rot", `${Math.round(Math.random() * 720 - 360)}deg`);
    layer.append(c);
  }
  layer.append(h("div", { class: "msg" }, h("b", {}, title), h("span", {}, sub)));
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2000);
}

// ---------------------------------------------------------------- formatting

const dash = "—";
const fmtInt = (n) => (n == null ? dash : Math.round(n).toLocaleString("en-US"));
const fmtSleep = (min) => (min == null ? dash : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`);
const pct = (v, goal) => (v == null || !goal ? 0 : Math.min(100, Math.round((v / goal) * 100)));
const timeOf = (iso) => (iso ? iso.slice(11, 16) : "");
const muscleList = (ids) => ids.filter((m) => MUSCLE_NAMES[m]).map((m) => MUSCLE_NAMES[m].toLowerCase()).join(" · ");
function dayLabel(date) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// ---------------------------------------------------------------- components

function scoreRing(score) {
  const parts = [
    ["sleep", "#22D3EE"], ["move", "#FF6A1A"], ["food", "#FFC53D"], ["gym", "#3DFF8F"],
  ];
  const R = 32, C = 38, gap = 10;
  const arc = (a0, a1) => {
    const p = (a) => [C + R * Math.cos((a - 90) * Math.PI / 180), C + R * Math.sin((a - 90) * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${a1 - a0 > 180 ? 1 : 0},1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  let paths = "";
  parts.forEach(([k, color], i) => {
    const a0 = i * 90 + gap / 2;
    const span = 90 - gap;
    paths += `<path d="${arc(a0, a0 + span)}" stroke="#1E2230" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    const v = score.parts[k];
    if (v) paths += `<path d="${arc(a0, a0 + span * Math.max(v / 25, 0.02))}" stroke="${color}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  });
  const wrap = h("div", { class: `ring${score.value >= 90 ? " perfect" : ""}`, "aria-label": `Daily score ${score.value}` });
  wrap.innerHTML = `<svg viewBox="0 0 76 76">${paths}</svg>`; // static markup built from numbers only
  wrap.append(h("div", { class: "val num" }, score.value));
  return wrap;
}

function hud(d) {
  const p = d.progress;
  const milestone = [7, 14, 30, 50, 100].includes(p.streak_days);
  return h("header", { class: "hud" },
    scoreRing(d.score),
    h("img", { class: "mascot", src: `mascot/${d.mascot}.png`, alt: `Pip is ${d.mascot}`, width: 40, height: 40 }),
    h("div", { class: "hud-mid" },
      h("div", { class: "lv" }, h("span", {}, `LV ${p.level}`), h("small", { class: "num" }, `${p.xp}/${p.xp_next} XP`)),
      h("div", { class: "xpbar" }, Object.assign(h("i"), { style: `width:${pct(p.xp, p.xp_next)}%` })),
      h("div", { class: "dim", style: null }, h("small", {}, d.score.value >= 90 ? "PERFECT DAY" : "Daily score")),
    ),
    h("div", { class: `streak${milestone ? " milestone" : ""}`, title: `Best ${p.best_streak}`, html: icon("flame") },
      h("span", { class: "num" }, p.streak_days)),
  );
}

function bodyMap(gym) {
  if (!S.bodySvg) return h("div", { class: "faint" }, "Body map unavailable");
  const svg = S.bodySvg.cloneNode(true);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.classList.add("body", gym.status);
  if (Date.now() < S.sweepUntil) svg.classList.add("sweep"); // only right after logging, not on every render
  const on = new Set(gym.muscles);
  if (on.has("calves")) on.add("calves_front");
  for (const id of on) svg.querySelector(`#${id}`)?.classList.add("on");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", gym.muscles.length ? `Muscles: ${muscleList(gym.muscles)}` : "Rest day");
  return svg;
}

function statusPill(gym) {
  if (gym.status === "done") return h("span", { class: "pill done", html: icon("check") }, `Done${gym.done_min ? ` · ${gym.done_min} min` : ""}`);
  if (gym.status === "rest") return h("span", { class: "pill rest" }, "Recovery day");
  if (gym.status === "skipped") return h("span", { class: "pill skipped" }, "Skipped");
  return h("span", { class: "pill" }, "Let's go");
}

function weekStrip(d) {
  const glyph = (state) => (state === "rest" ? icon("moon") : state === "missed" || state === "skipped" ? icon("x") : "");
  return h("div", { class: "panel" },
    h("div", { class: "row" }, h("h2", { class: "label grow" }, "This week"),
      h("span", { class: "dim num" }, `${d.gym.week_done}/${d.gym.week_target} sessions`)),
    h("div", { class: "week" }, d.week.map((w) =>
      h("div", { class: "day" }, h("div", { class: `dot ${w.state}`, html: glyph(w.state), title: w.state }), w.d))),
  );
}

function metricCards(d) {
  const sleepHit = d.sleep.asleep_min != null && d.sleep.asleep_min >= d.sleep.goal_min;
  const stepsHit = d.steps.value != null && d.steps.value >= d.steps.goal;
  const protHit = d.food.protein_g != null && d.food.protein_g >= d.food.protein_goal;
  const card = (cls, label, value, sub, p, hit) =>
    h("div", { class: `card ${cls}${hit ? " hit" : ""}` },
      h("div", { class: "label" }, label),
      h("div", { class: `v num${value === dash ? " faint" : ""}` }, value),
      h("div", { class: "s num" }, sub),
      h("div", { class: "bar" }, Object.assign(h("i"), { style: `width:${p}%` })));
  return h("div", { class: "cards" },
    card("sleep", "Sleep", fmtSleep(d.sleep.asleep_min), `goal ${fmtSleep(d.sleep.goal_min)}`, pct(d.sleep.asleep_min, d.sleep.goal_min), sleepHit),
    card("move", "Steps", fmtInt(d.steps.value), `of ${fmtInt(d.steps.goal)}`, pct(d.steps.value, d.steps.goal), stepsHit),
    card("food", "Protein", d.food.protein_g == null ? dash : `${d.food.protein_g} g`,
      d.food.kcal == null ? `goal ${d.food.protein_goal} g` : `${fmtInt(d.food.kcal)} kcal`, pct(d.food.protein_g, d.food.protein_goal), protHit),
  );
}

// ---------------------------------------------------------------- views

function viewToday() {
  const t = S.today;
  const d = t.dashboard;
  const g = d.gym;
  const isRest = g.status === "rest" || (g.day_type === "rest" && g.status !== "done");
  const title = isRest ? h("h1", { class: "rest" }, "Today: ", h("span", {}, "Rest day"))
    : h("h1", {}, "Today: ", h("span", {}, g.label));
  const logged = t.entry || g.status === "done" || g.status === "skipped";

  const buttons = [];
  if (g.status !== "done") buttons.push(h("button", { class: "btn primary wide", onclick: openSheet, html: icon("check") }, "I trained"));
  else buttons.push(h("button", { class: "btn wide", onclick: openSheet }, "Edit session"));
  if (g.status === "pending") buttons.push(h("button", { class: "btn", onclick: skipToday }, "Skip today"));
  if (t.entry) buttons.push(h("button", { class: `btn ghost${g.status === "pending" ? "" : " wide"}`, onclick: undoToday }, "Undo"));

  return h("div", { class: "stack" },
    h("div", { class: "today-head" }, title, statusPill(g)),
    h("div", { class: `coach ${d.coach.tone}` }, d.coach.text),
    h("div", { class: "panel body-wrap" },
      bodyMap(g),
      h("div", { class: "muscle-names" }, isRest && !g.muscles.length ? "Muscles grow now" : muscleList(g.muscles) || dash)),
    h("div", { class: "actions" }, buttons),
    logged && t.entry?.note ? h("div", { class: "dim" }, `Note: ${t.entry.note}`) : null,
    metricCards(d),
    h("div", { class: `sync${d.stale ? " stale" : ""}` },
      d.updated ? `${d.stale ? "Health data is old · last sync" : "Health synced"} ${timeOf(d.updated)}` : "No Apple Health sync yet"),
    weekStrip(d),
  );
}

function viewBp() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  if (!S.bpDraft) S.bpDraft = { sys: "", dia: "", pulse: "", ts: local };
  const draft = S.bpDraft;
  const err = h("div", { class: "err", role: "alert" });
  const field = (name, placeholder, required) => h("input", {
    class: "input num", name, inputmode: "numeric", pattern: "[0-9]*", required, placeholder, autocomplete: "off",
    value: draft[name], oninput: (e) => { draft[name] = e.target.value; },
  });
  const form = h("form", { class: "panel stack", onsubmit: (e) => { e.preventDefault(); saveBp(err); } },
    h("h2", { class: "label" }, "Log blood pressure"),
    h("div", { class: "bp-fields" },
      h("label", { class: "field" }, h("span", { class: "label" }, "SYS"), field("sys", "120", true)),
      h("label", { class: "field" }, h("span", { class: "label" }, "DIA"), field("dia", "80", true)),
      h("label", { class: "field" }, h("span", { class: "label" }, "Pulse"), field("pulse", "65", false)),
    ),
    h("label", { class: "field" }, h("span", { class: "label" }, "Time"),
      h("input", { class: "input", type: "datetime-local", name: "ts", value: draft.ts, max: local,
        oninput: (e) => { draft.ts = e.target.value; } })),
    err,
    h("button", { class: "btn primary", type: "submit" }, "Save reading"),
  );

  const readings = (S.history?.days || []).flatMap((day) => day.bp).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 14);
  return h("div", { class: "stack" },
    h("h1", {}, "Blood pressure"),
    form,
    readings.length ? bpChart(readings) : null,
    h("div", { class: "list" }, readings.length ? readings.map((r) =>
      h("div", { class: "item" }, h("div", { class: "top" },
        h("strong", { class: "num" }, `${r.sys}/${r.dia}`),
        h("span", { class: "dim num" }, r.pulse ? `♥ ${r.pulse}` : ""),
        h("span", { class: "dim num" }, `${dayLabel(r.ts.slice(0, 10))} · ${timeOf(r.ts)}`))),
    ) : h("div", { class: "faint" }, S.history ? "No readings in the last 14 days." : "Loading…")),
  );
}

function bpChart(readings) {
  const pts = [...readings].reverse();
  const W = 340, Hh = 120, pad = 18;
  const vals = pts.flatMap((r) => [r.sys, r.dia]);
  const lo = Math.min(...vals) - 6, hi = Math.max(...vals) + 6;
  const x = (i) => pad + (pts.length === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (pts.length - 1));
  const y = (v) => Hh - pad - ((v - lo) / (hi - lo)) * (Hh - 2 * pad);
  const line = (k) => pts.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
  const dots = (k, c) => pts.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r[k]).toFixed(1)}" r="3" fill="${c}"/>`).join("");
  const el = h("div", { class: "panel" }, h("h2", { class: "label" }, "Trend"));
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Blood pressure trend">
    <path d="${line("sys")}" fill="none" stroke="#F4F5F8" stroke-width="2"/>${dots("sys", "#F4F5F8")}
    <path d="${line("dia")}" fill="none" stroke="#22D3EE" stroke-width="2"/>${dots("dia", "#22D3EE")}
    <text x="${pad}" y="12" fill="#8A90A2" font-size="10">${hi - 6}</text>
    <text x="${pad}" y="${Hh - 4}" fill="#8A90A2" font-size="10">${lo + 6}</text></svg>`;
  el.append(Object.assign(h("div"), { innerHTML: svg })); // numbers only
  el.append(h("div", { class: "dim" }, h("small", {}, "White = systolic · cyan = diastolic")));
  return el;
}

function viewPlan() {
  if (!S.config) return h("div", { class: "faint" }, "Loading…");
  if (!S.planDraft) S.planDraft = structuredClone(S.config);
  const c = S.planDraft;
  const splitKeys = Object.keys(c.splits);
  const err = h("div", { class: "err", role: "alert" });

  const schedule = h("div", { class: "panel stack" }, h("h2", { class: "label" }, "Weekly schedule"),
    WEEKDAYS.map((d) => h("label", { class: "plan-row" }, h("strong", {}, WEEKDAY_LABEL[d]),
      h("select", { class: "input", onchange: (e) => { c.schedule[d] = e.target.value; } },
        splitKeys.map((k) => h("option", { value: k, selected: c.schedule[d] === k }, c.splits[k].label))))));

  const splits = h("div", { class: "panel stack" }, h("h2", { class: "label" }, "Splits"),
    splitKeys.filter((k) => k !== "rest").map((k) => h("div", { class: "stack" },
      h("div", { class: "row" },
        h("input", { class: "input grow", value: c.splits[k].label, maxlength: 12, "aria-label": `${k} label`,
          oninput: (e) => { c.splits[k].label = e.target.value; } }),
        h("button", { class: "btn small ghost danger", type: "button", onclick: () => removeSplit(k) }, "Remove")),
      h("div", { class: "chips" }, MUSCLE_ORDER.map((m) => {
        const chip = h("button", { type: "button", class: `chip${c.splits[k].muscles.includes(m) ? " on" : ""}`,
          "aria-pressed": String(c.splits[k].muscles.includes(m)) }, MUSCLE_NAMES[m]);
        chip.addEventListener("click", () => {
          const list = c.splits[k].muscles;
          const i = list.indexOf(m);
          if (i >= 0) list.splice(i, 1); else list.push(m);
          chip.classList.toggle("on", i < 0);
          chip.setAttribute("aria-pressed", String(i < 0));
        });
        return chip;
      })))),
    h("button", { class: "btn small", type: "button", onclick: addSplit }, "+ Add split"));

  const goals = h("div", { class: "panel stack" }, h("h2", { class: "label" }, "Goals"),
    h("div", { class: "goal-grid" }, GOAL_FIELDS.map(([k, label]) => h("label", { class: "field" },
      h("span", { class: "label" }, label),
      h("input", { class: "input num", inputmode: "numeric", value: c.goals[k],
        oninput: (e) => { c.goals[k] = e.target.value === "" ? null : Number(e.target.value); } })))));

  return h("div", { class: "stack" },
    h("h1", {}, "Plan"),
    schedule, splits, goals, err,
    h("button", { class: "btn primary", onclick: () => savePlan(err) }, "Save plan"),
    h("button", { class: "btn ghost", onclick: () => { S.planDraft = null; render(); } }, "Discard changes"),
    h("button", { class: "btn ghost danger", onclick: () => { if (confirm("Log out of Gym Log on this phone?")) logout(); } }, "Log out"),
  );
}

function viewHistory() {
  if (!S.history) return h("div", { class: "faint" }, "Loading…");
  return h("div", { class: "stack" },
    h("h1", {}, "History"),
    h("div", { class: "list" }, S.history.days.map((d) => h("div", { class: "item" },
      h("div", { class: "top" },
        h("strong", {}, dayLabel(d.date)),
        h("span", { class: "dim" }, d.status === "done" ? (S.config?.splits[d.split]?.label || d.split.toUpperCase()) : d.plan_label),
        h("span", { class: `tag ${d.status}` }, d.status === "no_data" ? "no data" : d.status)),
      d.muscles.length ? h("div", { class: "sub" }, muscleList(d.muscles), d.duration_min ? ` · ${d.duration_min} min` : "") : null,
      d.note ? h("div", { class: "sub" }, `“${d.note}”`) : null,
      d.bp.length ? h("div", { class: "sub num" }, `BP ${d.bp.map((r) => `${r.sys}/${r.dia}`).join(", ")}`) : null,
    ))),
  );
}

function viewSheet() {
  const sh = S.sheet;
  const splits = Object.entries(S.config?.splits || {}).filter(([k, v]) => k !== "rest" && v.muscles.length);
  const chipsSplit = h("div", { class: "chips" },
    [...splits.map(([k, v]) => [k, v.label]), ["other", "Other"]].map(([k, label]) =>
      h("button", { type: "button", class: `chip${sh.split === k ? " on" : ""}`, onclick: () => pickSplit(k) }, label)));
  const chipsMuscle = h("div", { class: "chips" }, MUSCLE_ORDER.map((m) =>
    h("button", { type: "button", class: `chip lime${sh.muscles.includes(m) ? " on" : ""}`, "aria-pressed": String(sh.muscles.includes(m)),
      onclick: () => { sh.muscles = sh.muscles.includes(m) ? sh.muscles.filter((x) => x !== m) : [...sh.muscles, m]; render(); } },
    MUSCLE_NAMES[m])));
  const step = (delta) => { sh.duration = Math.max(5, Math.min(240, sh.duration + delta)); render(); };

  return [
    h("div", { class: "scrim", onclick: closeSheet }),
    h("div", { class: "sheet stack", role: "dialog", "aria-label": "Log session" },
      h("div", { class: "grab" }),
      h("h2", { class: "label" }, "Split"), chipsSplit,
      h("h2", { class: "label" }, "Muscles trained"), chipsMuscle,
      h("h2", { class: "label" }, "Duration"),
      h("div", { class: "stepper" },
        h("button", { class: "btn", type: "button", onclick: () => step(-5), "aria-label": "5 minutes less" }, "−"),
        h("div", { class: "val num" }, `${sh.duration} min`),
        h("button", { class: "btn", type: "button", onclick: () => step(5), "aria-label": "5 minutes more" }, "+")),
      h("input", { class: "input", placeholder: "Note (optional)", maxlength: 200, value: sh.note,
        oninput: (e) => { sh.note = e.target.value; } }),
      h("button", { class: "btn lime", onclick: saveSession, disabled: !sh.muscles.length }, "Save session"),
      h("button", { class: "btn ghost", onclick: closeSheet }, "Cancel"),
    ),
  ];
}

function viewLogin() {
  const err = h("div", { class: "err", role: "alert" }, S.loginError || "");
  const input = h("input", { class: "input", type: "password", name: "token", autocomplete: "off", autocapitalize: "off",
    spellcheck: "false", placeholder: "Paste your INGEST_TOKEN", required: true });
  return h("div", { class: "shell" }, h("form", { class: "login stack", onsubmit: async (e) => {
    e.preventDefault();
    S.token = input.value.trim();
    S.loginError = null;
    try {
      await Promise.all([loadToday(), loadConfig()]);
      store.set(TOKEN_KEY, S.token);
      render();
    } catch (ex) {
      if (ex.status !== 401) { S.token = null; err.textContent = ex.message; }
    }
  } },
    h("img", { class: "logo", src: "icons/icon-192.png", alt: "" }),
    h("h1", {}, "Gym Log"),
    h("p", { class: "dim" }, "Enter your app token once. It stays on this phone."),
    input, err,
    h("button", { class: "btn primary", type: "submit" }, "Unlock"),
  ));
}

// ---------------------------------------------------------------- actions (optimistic, with rollback)

async function optimistic(apply, request, onSuccess) {
  const snapshot = structuredClone(S.today);
  apply();
  render();
  try {
    const fresh = await request();
    S.today = fresh;
    S.history = null; // refetch lazily
    render();
    onSuccess?.(fresh);
  } catch (e) {
    if (e.status === 401) return;
    S.today = snapshot;
    render();
    toast(`Couldn't save: ${e.message}`);
  }
}

function openSheet() {
  const g = S.today.dashboard.gym;
  const e = S.today.entry;
  const plan = S.today.plan;
  const split = e?.split || (g.status === "done" ? g.day_type : plan.muscles.length ? plan.split : "push");
  S.sheet = {
    split,
    muscles: [...(g.status === "done" ? g.muscles : S.config?.splits[split]?.muscles || [])],
    duration: e?.duration_min || g.done_min || 60,
    note: e?.note || "",
  };
  render();
}

function pickSplit(k) {
  S.sheet.split = k;
  S.sheet.muscles = [...(S.config?.splits[k]?.muscles || [])];
  render();
}

function closeSheet() { S.sheet = null; render(); }

function saveSession() {
  const sh = S.sheet;
  const wasDone = S.today.dashboard.gym.status === "done";
  const body = { action: "done", split: sh.split, muscles: sh.muscles, duration_min: sh.duration, note: sh.note.trim() || null };
  S.sheet = null;
  optimistic(() => {
    const g = S.today.dashboard.gym;
    Object.assign(g, { status: "done", muscles: sh.muscles, done_min: sh.duration,
      label: S.config?.splits[sh.split]?.label || sh.split.toUpperCase(), day_type: sh.split });
    S.today.entry = { ...body, ts: new Date().toISOString() };
    if (!wasDone) {
      S.sweepUntil = Date.now() + 1500;
      celebrate(`${g.label} DAY COMPLETE`, "+50 XP");
    }
  }, () => api("POST", "/api/gym", body));
}

function skipToday() {
  optimistic(() => {
    S.today.dashboard.gym.status = "skipped";
    S.today.entry = { action: "skip" };
  }, () => api("POST", "/api/gym", { action: "skip" }));
}

function undoToday() {
  optimistic(() => {
    const g = S.today.dashboard.gym;
    Object.assign(g, { status: S.today.plan.muscles.length ? "pending" : "rest", muscles: S.today.plan.muscles,
      label: S.today.plan.label, done_min: null });
    S.today.entry = null;
  }, () => api("POST", "/api/gym", { action: "undo" }));
}

async function saveBp(err) {
  const f = S.bpDraft;
  const sys = Number(f.sys), dia = Number(f.dia);
  const pulse = f.pulse ? Number(f.pulse) : null;
  if (!(sys > dia)) { err.textContent = "SYS should be higher than DIA."; return; }
  const ts = f.ts ? new Date(f.ts).toISOString() : new Date().toISOString();
  const body = { sys, dia, pulse, ts };
  const snapshot = structuredClone(S.history);
  // optimistic: show the reading at the top of the list straight away
  if (S.history?.days?.length) S.history.days[0].bp.push({ ...body, ts: localIso(new Date(ts)) });
  err.textContent = "";
  render();
  try {
    S.today = await api("POST", "/api/bp", body);
    S.bpDraft = null;
    await loadHistory();
    render();
    toast("Reading saved", true);
  } catch (e) {
    if (e.status === 401) return;
    S.history = snapshot;
    render();
    toast(`Couldn't save: ${e.message}`);
  }
}

function localIso(d) {
  const off = -d.getTimezoneOffset();
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return new Date(d.getTime() + off * 60000).toISOString().slice(0, 19) + (off >= 0 ? "+" : "-") + p(off / 60) + ":" + p(off % 60);
}

function addSplit() {
  const name = prompt("Name of the new split (e.g. Arms)");
  if (!name) return;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20);
  if (!key || S.planDraft.splits[key]) { toast("That split already exists or the name is invalid."); return; }
  S.planDraft.splits[key] = { label: name.trim().toUpperCase().slice(0, 12), muscles: [] };
  render();
}

function removeSplit(k) {
  const used = WEEKDAYS.filter((d) => S.planDraft.schedule[d] === k);
  if (used.length) { toast(`Used on ${used.map((d) => WEEKDAY_LABEL[d]).join(", ")}. Change those days first.`); return; }
  delete S.planDraft.splits[k];
  render();
}

async function savePlan(err) {
  err.textContent = "";
  try {
    S.config = await api("PUT", "/api/config", S.planDraft);
    S.planDraft = null;
    await loadToday();
    render();
    toast("Plan saved", true);
  } catch (e) {
    if (e.status !== 401) err.textContent = e.message;
  }
}

// ---------------------------------------------------------------- render + navigation

const TABS = [["today", "Today", "today"], ["bp", "BP", "heart"], ["plan", "Plan", "plan"], ["history", "History", "history"]];

function nav() {
  return h("nav", { class: "nav" }, TABS.map(([id, label, ic]) =>
    h("button", { class: S.tab === id ? "on" : "", "aria-current": S.tab === id ? "page" : null, onclick: () => goTab(id),
      html: icon(ic) }, label)));
}

async function goTab(id) {
  S.tab = id;
  store.set(TAB_KEY, id);
  window.scrollTo(0, 0);
  render();
  try {
    if ((id === "bp" || id === "history") && !S.history) { await loadHistory(); render(); }
    if (id === "plan" && !S.config) { await loadConfig(); render(); }
  } catch (e) {
    if (e.status !== 401) toast(e.message);
  }
}

function render() {
  const root = document.getElementById("app");
  const y = window.scrollY;
  if (!S.token) { root.replaceChildren(viewLogin()); return; }
  if (!S.today) { root.replaceChildren(h("div", { class: "boot" }, "Loading…")); return; }
  const views = { today: viewToday, bp: viewBp, plan: viewPlan, history: viewHistory };
  root.replaceChildren(
    h("main", { class: "shell" }, hud(S.today.dashboard), (views[S.tab] || viewToday)()),
    nav(),
    ...(S.sheet ? viewSheet() : []),
  );
  window.scrollTo(0, y);
}

async function refresh() {
  if (!S.token) return;
  try {
    await loadToday();
    if (!S.sheet) render();
  } catch { /* keep showing what we have */ }
}

async function boot() {
  await loadBody();
  if (!S.token) { render(); return; }
  try {
    await Promise.all([loadToday(), loadConfig()]);
  } catch (e) {
    if (e.status !== 401) {
      document.getElementById("app").replaceChildren(h("div", { class: "shell stack" },
        h("h1", {}, "Gym Log"), h("p", { class: "err" }, e.message),
        h("button", { class: "btn primary", onclick: () => location.reload() }, "Retry")));
      return;
    }
  }
  render();
  if (S.tab !== "today") goTab(S.tab);
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
boot();
