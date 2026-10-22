// Gym Log — phone app for the desk dashboard. Plain JS, no build step.
// All logic (status, score, XP, streak) lives on the server; this app logs and displays.
// The DOM is built with createElement/createElementNS only (no innerHTML), which the strict CSP relies on.
"use strict";

// ---------------------------------------------------------------- constants

const TOKEN_KEY = "gymlog.token";
const TAB_KEY = "gymlog.tab";
const SVGNS = "http://www.w3.org/2000/svg";

const MUSCLE_NAMES = {
  chest: "Chest", front_delts: "Front delts", side_delts: "Side delts", rear_delts: "Rear delts",
  biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", abs: "Abs", obliques: "Obliques",
  traps: "Traps", upper_back: "Upper back", lats: "Lats", lower_back: "Lower back",
  glutes: "Glutes", quads: "Quads", hamstrings: "Hamstrings", calves: "Calves",
};
const MUSCLE_ORDER = Object.keys(MUSCLE_NAMES);
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const GOAL_FIELDS = [
  ["steps", "Steps"], ["active_kcal", "Active kcal"], ["kcal", "Food kcal"],
  ["protein_g", "Protein g"], ["sleep_min", "Sleep min"], ["gym_per_week", "Gym / week"],
];
const AUTO_SOURCE = { gym: "Auto · your plan", steps: "Auto · Apple Health", sleep_early: "Auto · Apple Health" };
const TEAL = "#2DD4BF";
const GOLD = "#FFC53D";

// ---------------------------------------------------------------- DOM helpers

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "c") el.style.setProperty("--c", v);          // split colour
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function s(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
}

/** A Material Symbols icon (Rounded, filled), from icons.js. */
function icon(name, cls = "") {
  const svg = s("svg", { viewBox: "0 -960 960 960", class: `ms ${cls}`.trim(), "aria-hidden": "true" });
  svg.append(s("path", { d: (window.MS_ICONS || {})[name] || (window.MS_ICONS || {}).bolt || "" }));
  return svg;
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
  sheet: null,      // { type: "session" | "day", ... }
  loginError: null,
  bodySvg: null,    // parsed body.svg, cloned per render
  planDraft: null,
  bpDraft: null,
  sweepUntil: 0,    // play the bottom-to-top "done" sweep until this time
  openSplit: null,  // split whose muscle chips are expanded in Plan
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
    throw new ApiError(0, "No connection");
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
async function loadHistory() { S.history = await api("GET", "/api/history?days=45"); }

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

// ---------------------------------------------------------------- feedback: one toast at a time, 2 s

let toastEl = null;
let toastTimer = 0;
function toast(message, kind = "ok") {
  clearTimeout(toastTimer);
  toastEl?.remove();
  toastEl = h("div", { class: `toast ${kind}`, role: "status" }, icon(kind === "ok" ? "check" : "close"), message);
  document.body.append(toastEl);
  toastTimer = setTimeout(() => { toastEl?.remove(); toastEl = null; }, 2000);
}

/** Centred card on a blurred backdrop; confetti falls behind the card and never over the header. */
function celebrate({ title, xp, sub, color, iconName }) {
  document.querySelector(".celebrate")?.remove();
  const headerBottom = Math.max(0, document.querySelector(".hud, .titlebar")?.getBoundingClientRect().bottom ?? 0);
  const layer = h("div", { class: "confetti-layer", "aria-hidden": "true" });
  layer.style.top = `${headerBottom}px`;
  const colors = ["#FF6A1A", "#3DFF8F", "#FFC53D", "#22D3EE", "#8B7CFF"];
  for (let i = 0; i < 36; i++) {
    const c = h("i", { class: "confetti" });
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.5}s`;
    c.style.setProperty("--dx", `${(Math.random() - 0.5) * 140}px`);
    c.style.setProperty("--rot", `${Math.round(Math.random() * 720 - 360)}deg`);
    layer.append(c);
  }
  const card = h("div", { class: "cele-card", c: color, role: "dialog", "aria-label": title },
    h("div", { class: "badge" }, icon(iconName)),
    h("div", { class: "t-title" }, title),
    h("div", { class: "xp num" }, xp),
    sub ? h("div", { class: "dim" }, sub) : null);
  const close = () => { overlay.classList.add("out"); setTimeout(() => overlay.remove(), 300); };
  const overlay = h("div", { class: "celebrate", onclick: close }, layer, card);
  document.body.append(overlay);
  setTimeout(close, 2500);
}

// ---------------------------------------------------------------- formatting

const dash = "—";
const fmtInt = (n) => (n == null ? dash : Math.round(n).toLocaleString("en-US"));
const fmtSleep = (min) => (min == null ? dash : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`);
const pct = (v, goal) => (v == null || !goal ? 0 : Math.min(100, Math.round((v / goal) * 100)));
const timeOf = (iso) => (iso ? iso.slice(11, 16) : "");
function muscleList(ids) {
  const short = (id) => (id.includes("delts") ? "delts" : (MUSCLE_NAMES[id] || id).toLowerCase());
  return [...new Set(ids.filter((m) => MUSCLE_NAMES[m]).map(short))].join(" · ");
}
const dateOf = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const dayLabel = (date) => dateOf(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const splitOf = (key) => S.config?.splits?.[key] || { label: key.toUpperCase(), color: "#FF6A1A", icon: "fitness_center", muscles: [] };

// ---------------------------------------------------------------- shared components

/** Score ring: one segment per habit, done = lime (gold when perfect). */
function scoreRing(score) {
  const wrap = h("div", { class: `ring${score.perfect ? " perfect" : ""}`, "aria-label": `Daily score ${score.value}%` });
  const svg = s("svg", { viewBox: "0 0 88 88" });
  const R = 38, C = 2 * Math.PI * R, n = Math.max(score.total, 1), gap = n > 1 ? 4 : 0;
  const seg = C / n - gap;
  score.tasks.forEach((t, i) => {
    svg.append(s("circle", {
      cx: 44, cy: 44, r: R, fill: "none", "stroke-width": 8, "stroke-linecap": "round",
      stroke: t.done ? (score.perfect ? GOLD : "#3DFF8F") : "#222631",
      "stroke-dasharray": `${Math.max(seg - 4, 1)} ${C}`, "stroke-dashoffset": `${-(i * (seg + gap) + 2)}`,
    }));
  });
  wrap.append(svg, h("div", { class: "val" }, h("b", { class: "num" }, `${score.value}%`),
    h("span", { class: "num" }, score.perfect ? "PERFECT" : `${score.done}/${score.total} habits`)));
  return wrap;
}

function hud(d) {
  const p = d.progress;
  return h("header", { class: "hud" },
    scoreRing(d.score),
    h("div", { class: "hud-mid" },
      h("div", { class: "hud-lv" }, h("b", {}, `LV ${p.level}`), h("span", { class: "t-caption num" }, `${p.xp}/${p.xp_next} XP`)),
      xpBar(p),
      h("div", { class: "t-caption" }, d.score.perfect ? "Perfect day" : "Daily score")),
    h("div", { class: "hud-right" },
      h("img", { class: "mascot", src: `mascot/${d.mascot}.png`, alt: `Pip is ${d.mascot}`, width: 44, height: 44 }),
      streakChip(p)));
}

function xpBar(p) {
  const bar = h("div", { class: "xpbar" });
  const fill = h("i");
  fill.style.width = `${pct(p.xp, p.xp_next)}%`;
  bar.append(fill);
  return bar;
}

function streakChip(p) {
  return h("span", { class: "chip-stat num", title: `Best streak ${p.best_streak}` }, icon("local_fire_department"), p.streak_days);
}

function titlebar(title, right) {
  return h("header", { class: "titlebar" }, h("h1", { class: "t-title" }, title), right || null);
}

/** Body map from body.svg. Lights polygons whose data-ids include today's muscles. */
function bodyMap(gym, { mini = false, color } = {}) {
  if (!S.bodySvg) return h("div", { class: "faint" }, "Body map unavailable");
  const svg = S.bodySvg.cloneNode(true);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("class", `${mini ? "mini-body" : "bodymap"} ${gym.status}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", gym.muscles.length ? `Muscles: ${muscleList(gym.muscles)}` : "No muscles");
  if (color) svg.style.setProperty("--c", color);
  const on = new Set(gym.muscles);
  if (on.has("calves")) on.add("calves_front");
  const lit = [...svg.querySelectorAll(".muscle")].filter((p) => (p.getAttribute("data-ids") || "").split(" ").some((id) => on.has(id)));
  if (mini) {
    lit.forEach((p) => p.classList.add("on"));
    return svg;
  }
  // soft outer glow via an SVG filter (works in Safari, unlike CSS filters on SVG children)
  const defs = s("defs");
  const f = s("filter", { id: "glow", x: "-30%", y: "-30%", width: "160%", height: "160%" });
  f.append(s("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 10, result: "b" }));
  const merge = s("feMerge");
  merge.append(s("feMergeNode", { in: "b" }), s("feMergeNode", { in: "SourceGraphic" }));
  f.append(merge);
  defs.append(f);
  svg.prepend(defs);

  const sweep = gym.status === "done" && Date.now() < S.sweepUntil;
  if (!sweep) {
    lit.forEach((p) => { p.classList.add("on"); p.setAttribute("filter", "url(#glow)"); });
    return svg;
  }
  // Done: lime sweeps in from bottom to top (a clip rect animated with SMIL)
  const vb = svg.viewBox.baseVal;
  const clip = s("clipPath", { id: "sweep" });
  const rect = s("rect", { x: vb.x, y: vb.y + vb.height, width: vb.width, height: 0 });
  rect.append(s("animate", { attributeName: "y", from: vb.y + vb.height, to: vb.y, dur: "0.7s", fill: "freeze" }),
    s("animate", { attributeName: "height", from: 0, to: vb.height, dur: "0.7s", fill: "freeze" }));
  clip.append(rect);
  defs.append(clip);
  const g = s("g", { "clip-path": "url(#sweep)", filter: "url(#glow)" });
  lit.forEach((p) => { const c = p.cloneNode(); c.classList.add("on"); g.append(c); });
  svg.append(g);
  return svg;
}

function restArt(iconName) {
  return h("div", { class: "rest-art" },
    iconName === "hot_tub" ? h("div", { class: "steam", "aria-hidden": "true" }, h("i"), h("i"), h("i")) : null,
    icon(iconName, "big"));
}

function statusChip(g) {
  if (g.status === "done") return h("span", { class: "status done" }, icon("check"), g.done_min ? `DONE · ${g.done_min} MIN` : "DONE");
  if (g.status === "rest") return h("span", { class: "status", c: TEAL }, icon(g.icon), "RECOVERY");
  if (g.status === "skipped") return h("span", { class: "status skipped" }, "SKIPPED");
  return h("span", { class: "status" }, icon("bolt"), "LET'S GO");
}

// ---------------------------------------------------------------- Today

function viewToday() {
  const t = S.today;
  const d = t.dashboard;
  const g = d.gym;
  const rest = g.status === "rest";
  const color = rest ? TEAL : g.color;

  const actions = [];
  if (g.status === "pending") {
    actions.push(h("button", { class: "btn primary", onclick: openSession }, icon("check"), "I trained"),
      h("div", { class: "row between" }, h("span"), h("button", { class: "link", onclick: skipToday }, "Skip today")));
  }
  else if (g.status === "done") {
    actions.push(h("div", { class: "btn-row" },
      h("button", { class: "btn", onclick: openSession }, "Edit session"),
      h("button", { class: "btn ghost", onclick: undoToday }, icon("undo"), "Undo")));
  }
  else if (g.status === "skipped") {
    actions.push(h("button", { class: "btn primary", onclick: openSession }, icon("check"), "I trained after all"),
      h("div", { class: "row between" }, h("span"), h("button", { class: "link", onclick: undoToday }, "Undo skip")));
  }
  else actions.push(h("button", { class: "btn block", onclick: openSession }, icon("add"), "I trained anyway"));

  const hero = h("section", { class: "hero", c: color },
    h("div", { class: "hero-top" }, h("div", { class: "t-label" }, `Today · ${dayLabel(t.date)}`), statusChip(g)),
    h("div", { class: "hero-name" }, icon(g.icon), h("div", { class: "t-display" }, g.label)),
    h("p", { class: "coach t-body" }, d.coach.text),
    rest ? restArt(g.icon) : bodyMap(g),
    h("div", { class: "muscle-names" }, rest ? "Recovery is training too" : muscleList(g.muscles) || dash),
    h("div", { class: "stack" }, actions));
  hero.lastChild.style.marginTop = "16px";

  return h("div", { class: "stack" },
    hud(d), hero, habitsCard(d.score), metricCards(d),
    h("div", { class: `sync${d.stale ? " stale" : ""}` },
      d.updated ? `${d.stale ? "Health data is old · last sync" : "Health synced"} ${timeOf(d.updated)}` : "No Apple Health sync yet"),
    weekCard(d));
}

function habitsCard(score) {
  return h("section", { class: "card" },
    h("div", { class: "card-head" },
      h("h2", { class: "t-h2" }, "Daily habits"),
      h("span", { class: "t-label num" }, score.perfect ? "PERFECT DAY" : `${score.done} / ${score.total}`)),
    (() => { const b = h("div", { class: "habits-progress" }); const i = h("i"); i.style.width = `${score.value}%`; b.append(i); return b; })(),
    h("div", { style: null }, score.tasks.map((t) =>
      h("button", { class: `habit${t.done ? " done" : ""}`, "aria-pressed": String(t.done), onclick: () => toggleTask(t) },
        h("span", { class: "ic" }, icon(t.icon)),
        h("span", { class: "grow" }, h("div", { class: "name" }, t.label), t.auto ? h("div", { class: "src" }, AUTO_SOURCE[t.id] || "Auto") : null),
        h("span", { class: "tick" }, icon("check"))))));
}

function metricCards(d) {
  const card = (label, value, sub, p, hit, color) => {
    const bar = h("div", { class: "bar" });
    const i = h("i");
    i.style.width = `${p}%`;
    bar.append(i);
    return h("div", { class: `metric${hit ? " hit" : ""}`, c: color },
      h("div", { class: "t-label" }, label), h("div", { class: `v num${value === dash ? " faint" : ""}` }, value),
      h("div", { class: "s num" }, sub), bar);
  };
  return h("div", { class: "metrics" },
    card("Sleep", fmtSleep(d.sleep.asleep_min), `goal ${fmtSleep(d.sleep.goal_min)}`, pct(d.sleep.asleep_min, d.sleep.goal_min),
      d.sleep.asleep_min >= d.sleep.goal_min, "#8B7CFF"),
    card("Steps", fmtInt(d.steps.value), `of ${fmtInt(d.steps.goal)}`, pct(d.steps.value, d.steps.goal),
      d.steps.value >= d.steps.goal, "#22D3EE"),
    card("Protein", d.food.protein_g == null ? dash : `${d.food.protein_g} g`,
      d.food.kcal == null ? `goal ${d.food.protein_goal} g` : `${fmtInt(d.food.kcal)} kcal`,
      pct(d.food.protein_g, d.food.protein_goal), d.food.protein_g >= d.food.protein_goal, GOLD));
}

function weekCard(d) {
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "t-h2" }, "This week"),
      h("span", { class: "t-label num" }, `${d.gym.week_done} / ${d.gym.week_target} sessions`)),
    h("div", { class: "week" }, d.week.map((w) =>
      h("div", { class: `wday${w.state === "today" ? " is-today" : ""}` },
        h("div", { class: `wdot ${w.state}`, c: w.color, title: w.state },
          w.state === "missed" || w.state === "skipped" ? icon("close") : w.state === "planned" && !w.icon ? null : icon(w.icon)),
        w.d))));
}

// ---------------------------------------------------------------- BP

function viewBp() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  if (!S.bpDraft) S.bpDraft = { sys: "", dia: "", pulse: "", ts: local };
  const draft = S.bpDraft;
  const err = h("div", { class: "err", role: "alert" });
  const field = (name, label, placeholder, required) => h("label", { class: "field" }, h("span", { class: "t-label" }, label),
    h("input", { class: "input num", name, inputmode: "numeric", pattern: "[0-9]*", required, placeholder, autocomplete: "off",
      value: draft[name], oninput: (e) => { draft[name] = e.target.value; } }));
  const form = h("form", { class: "card stack", onsubmit: (e) => { e.preventDefault(); saveBp(err); } },
    h("div", { class: "bp-fields" }, field("sys", "SYS", "120", true), field("dia", "DIA", "80", true), field("pulse", "Pulse", "65", false)),
    h("label", { class: "field" }, h("span", { class: "t-label" }, "Time"),
      h("input", { class: "input", type: "datetime-local", name: "ts", value: draft.ts, max: local, oninput: (e) => { draft.ts = e.target.value; } })),
    err,
    h("button", { class: "btn primary", type: "submit", c: "#22D3EE" }, "Save reading"));

  const readings = (S.history?.days || []).flatMap((day) => day.bp).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 5);
  return h("div", { class: "stack" },
    titlebar("Vitals"),
    vitalsCard(S.today.dashboard),
    h("h2", { class: "t-h2" }, "Blood pressure"),
    form,
    h("section", { class: "card" }, h("h2", { class: "t-h2" }, "Recent readings"),
      readings.length ? readings.map((r) => h("div", { class: "reading" },
        h("b", { class: "t-h2 num" }, `${r.sys}/${r.dia}`),
        h("span", { class: "dim num" }, r.pulse ? `${r.pulse} bpm` : ""),
        h("span", { class: "dim num" }, `${dayLabel(r.ts)} · ${timeOf(r.ts)}`)))
        : h("p", { class: "dim" }, S.history ? "No readings in the last weeks." : "Loading…")));
}

/** Heart rate and blood oxygen, read from Apple Health by the Shortcut (no manual entry). */
function vitalsCard(d) {
  const v = d.vitals || {};
  const tile = (label, iconName, value, unit, color) => h("div", { class: "metric vital", c: color },
    h("div", { class: "row" }, icon(iconName), h("span", { class: "t-label" }, label)),
    h("div", { class: `v num${value == null ? " faint" : ""}` }, value == null ? dash : String(value), value == null ? null : h("small", {}, unit)));
  return h("section", { class: "stack" },
    h("div", { class: "metrics" },
      tile("Resting", "ecg_heart", v.resting_hr, " bpm", "#FF5A7A"),
      tile("Heart", "favorite", v.heart_rate, " bpm", "#FF8A5B"),
      tile("SpO₂", "spo2", v.spo2, " %", "#22D3EE")),
    h("div", { class: `sync${d.stale ? " stale" : ""}` },
      d.updated ? `From Apple Health · ${timeOf(d.updated)}` : "Heart rate and blood oxygen arrive with the Health sync"));
}

// ---------------------------------------------------------------- Plan

function dayLook(c, d) {
  const sp = c.splits[c.schedule[d]] || splitOf(c.schedule[d]);
  const o = c.days?.[d] || {};
  return { color: sp.color, icon: o.icon || sp.icon, label: o.label || sp.label };
}

function viewPlan() {
  if (!S.config) return h("div", { class: "faint" }, "Loading…");
  if (!S.planDraft) S.planDraft = structuredClone(S.config);
  const c = S.planDraft;
  const todayKey = S.today ? WEEKDAYS[(dateOf(S.today.date).getDay() + 6) % 7] : null;
  const err = h("div", { class: "err", role: "alert" });

  const tiles = h("div", { class: "tiles" }, WEEKDAYS.map((d) => {
    const look = dayLook(S.config, d);
    return h("button", { class: `tile${d === todayKey ? " today" : ""}`, c: look.color, "aria-label": `${WEEKDAY_SHORT[d]}: ${look.label}`,
      onclick: () => { S.sheet = { type: "day", day: d }; render(); } },
      h("span", { class: "d" }, WEEKDAY_SHORT[d]), icon(look.icon), h("span", { class: "n" }, look.label.split(" ")[0].slice(0, 5)));
  }));

  const splitCards = Object.entries(c.splits).filter(([k]) => k !== "rest").map(([k, sp]) => h("section", { class: "split-card", c: sp.color },
    h("div", { class: "split-head" },
      h("span", { class: "sw" }, icon(sp.icon)),
      h("input", { class: "input name grow", value: sp.label, maxlength: 12, "aria-label": `${k} name`, oninput: (e) => { sp.label = e.target.value; } }),
      h("button", { class: "link", type: "button", onclick: () => removeSplit(k), "aria-label": `Remove ${sp.label}` }, icon("close"))),
    h("div", { class: "split-body" },
      bodyMap({ status: "pending", muscles: sp.muscles }, { mini: true, color: sp.color }),
      h("div", { class: "stack" },
        h("div", { class: "sel" }, sp.muscles.length ? sp.muscles.map((m) => MUSCLE_NAMES[m] || m).join(", ") : "No muscles yet"),
        h("button", { class: "btn", type: "button", "aria-expanded": String(S.openSplit === k),
          onclick: () => { S.openSplit = S.openSplit === k ? null : k; render(); } }, S.openSplit === k ? "Done" : "Edit muscles"))),
    S.openSplit === k ? h("div", { class: "chips expanded" }, MUSCLE_ORDER.map((m) =>
      h("button", { type: "button", class: `chip${sp.muscles.includes(m) ? " on" : ""}`, "aria-pressed": String(sp.muscles.includes(m)),
        onclick: () => { const i = sp.muscles.indexOf(m); if (i >= 0) sp.muscles.splice(i, 1); else sp.muscles.push(m); render(); } },
      MUSCLE_NAMES[m]))) : null));

  const habits = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", { class: "t-h2" }, "Daily habits"),
      h("span", { class: "t-label" }, "All done = perfect day")),
    c.tasks.map((t, i) => h("div", { class: "habit" },
      h("span", { class: "ic" }, icon(t.icon)),
      h("input", { class: "input name grow", value: t.label, maxlength: 40, "aria-label": "Habit name",
        oninput: (e) => { t.label = e.target.value; } }),
      t.auto ? h("span", { class: "src" }, "auto") : null,
      h("button", { class: "link", type: "button", "aria-label": `Remove ${t.label}`, onclick: () => { c.tasks.splice(i, 1); render(); } }, icon("close")))),
    h("button", { class: "btn block", type: "button", onclick: addHabit }, icon("add"), "Add habit"));
  habits.querySelectorAll(".input.name").forEach((el) => { el.style.fontSize = "16px"; el.style.fontWeight = "500"; });

  const goals = h("section", { class: "card" }, h("h2", { class: "t-h2" }, "Goals"),
    h("div", { class: "goal-grid" }, GOAL_FIELDS.map(([k, label]) => h("label", { class: "field" },
      h("span", { class: "t-label" }, label),
      h("input", { class: "input num", inputmode: "numeric", value: c.goals[k], oninput: (e) => { c.goals[k] = e.target.value === "" ? null : Number(e.target.value); } }))),
      h("label", { class: "field" }, h("span", { class: "t-label" }, "Asleep by"),
        h("input", { class: "input num", type: "time", value: c.goals.sleep_by, oninput: (e) => { c.goals.sleep_by = e.target.value; } }))));
  goals.lastChild.style.marginTop = "16px";

  return h("div", { class: "stack" },
    titlebar("Plan", streakChip(S.today.dashboard.progress)),
    h("section", { class: "card" }, h("div", { class: "card-head" }, h("h2", { class: "t-h2" }, "Your week"),
      h("span", { class: "t-caption" }, "Tap a day to change it")), tiles),
    h("div", { class: "t-label" }, "Splits"),
    ...splitCards,
    h("button", { class: "btn block", type: "button", onclick: addSplit }, icon("add"), "Add split"),
    habits, goals, err,
    h("button", { class: "btn primary", c: "#FF6A1A", onclick: () => savePlan(err) }, "Save plan"),
    h("div", { class: "btn-row" },
      h("button", { class: "btn ghost", onclick: () => { S.planDraft = null; render(); } }, "Discard changes"),
      h("button", { class: "btn danger", onclick: () => { if (confirm("Log out of Gym Log on this phone?")) logout(); } }, "Log out")));
}

function daySheet(day) {
  const c = S.config;
  return [
    h("div", { class: "scrim", onclick: closeSheet }),
    h("div", { class: "sheet", role: "dialog", "aria-label": `Choose the split for ${WEEKDAY_SHORT[day]}` },
      h("div", { class: "grab" }),
      h("h2", { class: "t-h2" }, `${WEEKDAY_SHORT[day]} is…`),
      h("div", { style: null }, Object.entries(c.splits).map(([k, sp]) => {
        const label = k === c.schedule[day] ? dayLook(c, day).label : sp.label;
        const ic = k === "rest" && c.days?.[day]?.icon ? c.days[day].icon : sp.icon;
        return h("button", { class: `option${k === c.schedule[day] ? " on" : ""}`, c: sp.color, onclick: () => pickDay(day, k) },
          h("span", { class: "sw" }, icon(ic)), h("span", { class: "grow" }, label), k === c.schedule[day] ? icon("check") : null);
      })),
      h("button", { class: "btn ghost block", onclick: closeSheet }, "Cancel")),
  ];
}

// ---------------------------------------------------------------- History

function viewHistory() {
  if (!S.history) return h("div", { class: "stack" }, titlebar("History"), h("div", { class: "faint" }, "Loading…"));
  const byDate = Object.fromEntries(S.history.days.map((d) => [d.date, d]));
  const today = S.today.date;
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const monthName = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h("div"));
  let sessions = 0, perfect = 0, scored = 0, scoreSum = 0;
  for (let d = 1; d <= daysIn; d++) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const e = byDate[date];
    let cls = "future", color = null;
    if (date <= today) {
      cls = e ? e.status : "no_data";
      color = e?.color;
      if (e?.status === "done") sessions++;
      if (e && e.score != null && (e.status !== "no_data")) { scored++; scoreSum += e.score; if (e.score === 100) perfect++; }
    }
    cells.push(h("div", { class: `cell ${cls}${date === today ? " today" : ""}`, c: color, title: e ? `${date}: ${e.label} · ${e.status}` : date },
      d, e?.score === 100 ? h("span", { class: "perfect", "aria-label": "perfect day" }) : null));
  }

  const recent = S.history.days.filter((d) => d.status === "done").slice(0, 8);
  return h("div", { class: "stack" },
    titlebar("History", streakChip(S.today.dashboard.progress)),
    h("section", { class: "card" },
      h("div", { class: "card-head" }, h("h2", { class: "t-h2" }, monthName)),
      h("div", { class: "heat-head" }, ["M", "T", "W", "T", "F", "S", "S"].map((l) => h("span", {}, l))),
      h("div", { class: "heat" }, cells),
      h("div", { class: "legend" },
        ...Object.values(S.config.splits).filter((sp) => sp.muscles.length).map((sp) => h("span", { c: sp.color }, h("i"), sp.label.toLowerCase())),
        h("span", {}, h("i", { class: "rest" }), "rest"),
        h("span", {}, h("i", { class: "missed" }), "missed"),
        h("span", {}, h("i", { class: "perfect" }), "perfect day"))),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("b", { class: "num" }, sessions), h("span", { class: "t-caption" }, "sessions")),
      h("div", { class: "stat" }, h("b", { class: "num" }, perfect), h("span", { class: "t-caption" }, "perfect days")),
      h("div", { class: "stat" }, h("b", { class: "num" }, scored ? `${Math.round(scoreSum / scored)}%` : dash), h("span", { class: "t-caption" }, "avg score"))),
    h("h2", { class: "t-h2" }, "Recent sessions"),
    recent.length ? h("div", {}, recent.map((d) => h("article", { class: "session", c: d.color },
      h("span", { class: "ic" }, icon(d.icon)),
      h("div", { class: "grow" },
        h("div", { class: "row between" }, h("b", {}, d.label), h("span", { class: "meta num" }, dayLabel(d.date))),
        h("div", { class: "meta" }, [muscleList(d.muscles), d.duration_min ? `${d.duration_min} min` : null].filter(Boolean).join(" · ")),
        d.note ? h("div", { class: "meta" }, `“${d.note}”`) : null))))
      : h("p", { class: "dim" }, "No sessions yet. Tap “I trained” after your next workout."));
}

// ---------------------------------------------------------------- "I trained" sheet

function sessionSheet() {
  const sh = S.sheet;
  const sp = splitOf(sh.split);
  const splits = Object.entries(S.config?.splits || {}).filter(([, v]) => v.muscles.length);
  const step = (delta) => { sh.duration = Math.max(5, Math.min(240, sh.duration + delta)); render(); };
  return [
    h("div", { class: "scrim", onclick: closeSheet }),
    h("div", { class: "sheet stack", role: "dialog", "aria-label": "Log session", c: sp.color },
      h("div", { class: "grab" }),
      h("div", { class: "t-label" }, "Split"),
      h("div", { class: "chips" }, [...splits, ["other", { label: "OTHER", color: "#8A90A2", muscles: [] }]].map(([k, v]) =>
        h("button", { type: "button", class: `chip${sh.split === k ? " on" : ""}`, c: v.color, onclick: () => pickSplit(k) }, v.label))),
      h("div", { class: "split-body" },
        bodyMap({ status: "pending", muscles: sh.muscles }, { mini: true, color: sp.color }),
        h("div", { class: "stack" }, h("div", { class: "t-label" }, "Muscles trained"),
          h("div", { class: "chips" }, MUSCLE_ORDER.map((m) => h("button", {
            type: "button", class: `chip${sh.muscles.includes(m) ? " on" : ""}`, "aria-pressed": String(sh.muscles.includes(m)),
            onclick: () => { sh.muscles = sh.muscles.includes(m) ? sh.muscles.filter((x) => x !== m) : [...sh.muscles, m]; render(); },
          }, MUSCLE_NAMES[m]))))),
      h("div", { class: "t-label" }, "Duration"),
      h("div", { class: "stepper" },
        h("button", { class: "btn", type: "button", onclick: () => step(-5), "aria-label": "5 minutes less" }, icon("remove")),
        h("div", { class: "val num" }, `${sh.duration} min`),
        h("button", { class: "btn", type: "button", onclick: () => step(5), "aria-label": "5 minutes more" }, icon("add"))),
      h("input", { class: "input", placeholder: "Note (optional)", maxlength: 200, value: sh.note, oninput: (e) => { sh.note = e.target.value; } }),
      h("button", { class: "btn primary", onclick: saveSession, disabled: !sh.muscles.length }, icon("check"), "Save session"),
      h("button", { class: "btn ghost block", onclick: closeSheet }, "Cancel")),
  ];
}

// ---------------------------------------------------------------- login

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
    h("h1", { class: "t-title" }, "Gym Log"),
    h("p", { class: "dim" }, "Enter your app token once. It stays on this phone."),
    input, err,
    h("button", { class: "btn primary", type: "submit" }, "Unlock")));
}

// ---------------------------------------------------------------- actions (optimistic, with rollback)

async function optimistic(apply, request, { ok, onSuccess } = {}) {
  const snapshot = structuredClone(S.today);
  apply();
  render();
  try {
    const fresh = await request();
    S.today = fresh;
    S.history = null; // refetch lazily
    render();
    if (ok) toast(ok);
    onSuccess?.(fresh);
  } catch (e) {
    if (e.status === 401) return;
    S.today = snapshot;
    render();
    toast(`Couldn't save: ${e.message}`, "error");
  }
}

function openSession() {
  const g = S.today.dashboard.gym;
  const e = S.today.entry;
  const plan = S.today.plan;
  const split = e?.split || (g.status === "done" ? g.day_type : plan.muscles.length ? plan.split : "push");
  S.sheet = {
    type: "session",
    split,
    muscles: [...(g.status === "done" ? g.muscles : splitOf(split).muscles)],
    duration: e?.duration_min || g.done_min || 60,
    note: e?.note || "",
  };
  render();
}

function pickSplit(k) {
  S.sheet.split = k;
  S.sheet.muscles = [...splitOf(k).muscles];
  render();
}

function closeSheet() { S.sheet = null; render(); }

function recount(score) {
  score.done = score.tasks.filter((t) => t.done).length;
  score.value = score.total ? Math.round((100 * score.done) / score.total) : 0;
  score.perfect = score.total > 0 && score.done === score.total;
}

function saveSession() {
  const sh = S.sheet;
  const wasDone = S.today.dashboard.gym.status === "done";
  const sp = splitOf(sh.split);
  const body = { action: "done", split: sh.split, muscles: sh.muscles, duration_min: sh.duration, note: sh.note.trim() || null };
  S.sheet = null;
  optimistic(() => {
    const g = S.today.dashboard.gym;
    Object.assign(g, { status: "done", muscles: sh.muscles, done_min: sh.duration, label: sp.label, color: sp.color, icon: sp.icon, day_type: sh.split });
    S.today.entry = { ...body, ts: new Date().toISOString() };
    const gt = S.today.dashboard.score.tasks.find((t) => t.id === "gym");
    if (gt) { gt.done = true; recount(S.today.dashboard.score); }
    if (!wasDone) S.sweepUntil = Date.now() + 1500;
  }, () => api("POST", "/api/gym", body), {
    ok: wasDone ? "Session updated" : null,
    onSuccess: (fresh) => {
      if (wasDone) return;
      const c = fresh.dashboard.celebrate;
      celebrate({ title: c?.title || `${sp.label} DAY COMPLETE`, xp: "+50 XP", sub: c?.sub?.split("·").slice(1).join("·").trim() || null,
        color: sp.color, iconName: sp.icon });
    },
  });
}

function skipToday() {
  optimistic(() => {
    S.today.dashboard.gym.status = "skipped";
    S.today.entry = { action: "skip" };
  }, () => api("POST", "/api/gym", { action: "skip" }), { ok: "Skipped today. Back at it next time." });
}

function undoToday() {
  optimistic(() => {
    const g = S.today.dashboard.gym;
    const p = S.today.plan;
    Object.assign(g, { status: p.muscles.length ? "pending" : "rest", muscles: p.muscles, label: p.label, color: p.color, icon: p.icon, done_min: null });
    S.today.entry = null;
  }, () => api("POST", "/api/gym", { action: "undo" }), { ok: "Undone" });
}

function toggleTask(t) {
  const before = S.today.dashboard.score.perfect;
  const done = !t.done;
  optimistic(() => {
    const task = S.today.dashboard.score.tasks.find((x) => x.id === t.id);
    task.done = done;
    recount(S.today.dashboard.score);
  }, () => api("POST", "/api/tasks", { id: t.id, done }), {
    onSuccess: (fresh) => {
      if (!before && fresh.dashboard.score.perfect) {
        celebrate({ title: "PERFECT DAY", xp: "+30 XP", sub: "Every habit done", color: GOLD, iconName: "trophy" });
      }
    },
  });
}

async function saveBp(err) {
  const f = S.bpDraft;
  const sys = Number(f.sys), dia = Number(f.dia);
  const pulse = f.pulse ? Number(f.pulse) : null;
  if (!(sys > dia)) { err.textContent = "SYS should be higher than DIA."; return; }
  const ts = f.ts ? new Date(f.ts).toISOString() : new Date().toISOString();
  err.textContent = "";
  try {
    S.today = await api("POST", "/api/bp", { sys, dia, pulse, ts });
    S.bpDraft = null;
    await loadHistory();
    render();
    toast("Reading saved");
  } catch (e) {
    if (e.status !== 401) toast(`Couldn't save: ${e.message}`, "error");
  }
}

async function pickDay(day, split) {
  S.sheet = null;
  if (S.config.schedule[day] === split) { render(); return; }
  const schedule = { ...S.config.schedule, [day]: split };
  try {
    S.config = await api("PUT", "/api/config", { schedule });
    if (S.planDraft) S.planDraft.schedule = { ...schedule };
    await loadToday();
    render();
    toast(`${WEEKDAY_SHORT[day]} is now ${dayLook(S.config, day).label}`);
  } catch (e) {
    render();
    if (e.status !== 401) toast(`Couldn't save: ${e.message}`, "error");
  }
}

function addSplit() {
  const name = prompt("Name of the new split (e.g. Arms)");
  if (!name) return;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20);
  if (!key || S.planDraft.splits[key]) { toast("That split already exists", "error"); return; }
  S.planDraft.splits[key] = { label: name.trim().toUpperCase().slice(0, 12), color: "#FF6A1A", icon: "fitness_center", muscles: [] };
  render();
}

function removeSplit(k) {
  const used = WEEKDAYS.filter((d) => S.planDraft.schedule[d] === k);
  if (used.length) { toast(`Used on ${used.map((d) => WEEKDAY_SHORT[d]).join(", ")}. Change those days first.`, "error"); return; }
  delete S.planDraft.splits[k];
  render();
}

function addHabit() {
  const name = prompt("New daily habit (e.g. Drink 2 l water)");
  if (!name || !name.trim()) return;
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 16) || "habit";
  let id = base, n = 2;
  while (S.planDraft.tasks.some((t) => t.id === id)) id = `${base}_${n++}`;
  S.planDraft.tasks.push({ id, label: name.trim().slice(0, 40), icon: "check" });
  render();
}

async function savePlan(err) {
  err.textContent = "";
  const { schedule, days, splits, tasks, goals } = S.planDraft;
  try {
    S.config = await api("PUT", "/api/config", { schedule, days, splits, tasks, goals });
    S.planDraft = null;
    await loadToday();
    render();
    toast("Plan saved");
  } catch (e) {
    if (e.status !== 401) err.textContent = e.message;
  }
}

// ---------------------------------------------------------------- render + navigation

const TABS = [["today", "Today", "home"], ["bp", "Vitals", "monitor_heart"], ["plan", "Plan", "calendar_month"], ["history", "History", "history"]];

function nav() {
  return h("nav", { class: "nav" }, TABS.map(([id, label, ic]) =>
    h("button", { class: S.tab === id ? "on" : "", "aria-current": S.tab === id ? "page" : null, onclick: () => goTab(id) }, icon(ic), label)));
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
    if (e.status !== 401) toast(e.message, "error");
  }
}

function render() {
  const root = document.getElementById("app");
  const y = window.scrollY;
  if (!S.token) { root.replaceChildren(viewLogin()); return; }
  if (!S.today || !S.config) { root.replaceChildren(h("div", { class: "boot" }, "Loading…")); return; }
  const views = { today: viewToday, bp: viewBp, plan: viewPlan, history: viewHistory };
  const sheet = S.sheet?.type === "session" ? sessionSheet() : S.sheet?.type === "day" ? daySheet(S.sheet.day) : [];
  root.replaceChildren(h("main", { class: "shell" }, (views[S.tab] || viewToday)()), nav(), ...sheet);
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
        h("h1", { class: "t-title" }, "Gym Log"), h("p", { class: "err" }, e.message),
        h("button", { class: "btn primary", onclick: () => location.reload() }, "Retry")));
      return;
    }
  }
  render();
  if (S.tab !== "today") goTab(S.tab);
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
boot();
