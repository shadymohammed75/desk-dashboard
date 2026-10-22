// Visual check of the phone app at 390×844 in fixed states, with API answers from e2e/fixtures (made by the real
// Worker code in make_fixtures.ts). Static files come from a running `wrangler dev`.
//
//   npx tsx e2e/make_fixtures.ts && npx wrangler dev --port 8787 &
//   NODE_PATH=$(npm root -g) node e2e/visual.mjs http://localhost:8787 <out-dir>
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.argv[2] || "http://localhost:8787";
const OUT = process.argv[3] || "visual-out";
mkdirSync(OUT, { recursive: true });
const fx = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));

const problems = [];
const shots = [];

async function open(browser, state, tab = "today") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(([t]) => { localStorage.setItem("gymlog.token", "visual"); localStorage.setItem("gymlog.tab", t); }, [tab]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${state.name}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) problems.push(`${state.name}: ${m.text()}`); });
  let today = state.today, history = state.history;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/today") return json(today);
    if (path === "/api/config") return json(state.config);
    if (path === "/api/history") return json(history);
    if (path === "/api/gym") {
      const action = JSON.parse(req.postData() || "{}").action;
      await new Promise((r) => setTimeout(r, 150));
      if (action === "done" && state.after_gym) {
        today = state.after_gym;
        history = state.after_history;
      }
      else if (action === "skip") {
        today = structuredClone(today);
        today.dashboard.gym.status = "skipped";
        today.entry = { action: "skip" };
      }
      return json(today);
    }
    return json(today);
  });
  await page.goto(`${BASE}/app/`);
  await page.waitForSelector(tab === "today" ? ".hero" : ".titlebar");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  shots.push(name);
}

/** Every tappable thing must be at least 44 px tall (the chips' visible pill is 36 px with a 44 px hit area). */
async function checkTargets(page, label) {
  const small = await page.$$eval("button, input, select, .tile", (els) => els
    .filter((e) => e.offsetParent !== null && !e.classList.contains("chip"))
    .map((e) => ({ t: e.textContent.trim().slice(0, 20) || e.getAttribute("aria-label") || e.className, h: e.getBoundingClientRect().height }))
    .filter((x) => x.h < 44));
  if (small.length) problems.push(`${label}: small targets ${JSON.stringify(small)}`);
}

const browser = await chromium.launch();
const pending = { name: "push_pending", ...fx("push_pending") };
const done = { name: "push_done", ...fx("push_done") };
const spa = { name: "spa_day", ...fx("spa_day") };

// 1. push pending: every tab
for (const tab of ["today", "bp", "plan", "history"]) {
  const { ctx, page } = await open(browser, pending, tab);
  await checkTargets(page, `pending/${tab}`);
  await shot(page, `pending_${tab}`);
  if (tab === "plan") {
    await page.click(".tile >> nth=4");
    await page.waitForSelector(".sheet");
    await page.waitForTimeout(350);
    await shot(page, "pending_plan_day_sheet", false);
  }
  await ctx.close();
}

// 2. push done + celebration (through the real UI flow: I trained → sheet → save)
{
  const { ctx, page } = await open(browser, pending, "today");
  await page.click("button:has-text('I trained')");
  await page.waitForSelector(".sheet");
  await page.click(".sheet .chip:has-text('Side delts')");
  await page.click("button[aria-label='5 minutes less']");
  await page.waitForTimeout(350);
  await shot(page, "done_sheet", false);
  await page.click("button:has-text('Save session')");
  await page.waitForSelector(".cele-card");
  await page.waitForTimeout(700);
  await shot(page, "done_celebration", false);
  const overlap = await page.evaluate(() => {
    const hud = document.querySelector(".hud").getBoundingClientRect();
    return [...document.querySelectorAll(".confetti")].some((c) => c.getBoundingClientRect().bottom < hud.bottom - 1);
  });
  if (overlap) problems.push("confetti drawn over the header");
  await page.waitForTimeout(2600);
  if (await page.$(".celebrate")) problems.push("celebration did not auto-close after 2.5 s");
  await shot(page, "done_today");
  await ctx.close();
}
for (const tab of ["bp", "plan", "history"]) {
  const { ctx, page } = await open(browser, done, tab);
  await shot(page, `done_${tab}`);
  await ctx.close();
}

// 3. Sunday spa day: every tab
for (const tab of ["today", "bp", "plan", "history"]) {
  const { ctx, page } = await open(browser, spa, tab);
  await checkTargets(page, `spa/${tab}`);
  await shot(page, `spa_${tab}`);
  await ctx.close();
}

// 4. toast: one at a time, above the nav, gone after 2 s
{
  const { ctx, page } = await open(browser, pending, "today");
  await page.click("button:has-text('Skip today')");
  await page.waitForSelector(".toast");
  const n = await page.$$eval(".toast", (t) => t.length);
  const { tb, nt, text } = await page.evaluate(() => ({
    tb: document.querySelector(".toast").getBoundingClientRect().bottom,
    nt: document.querySelector(".nav").getBoundingClientRect().top,
    text: document.querySelector(".toast").textContent,
  }));
  if (n !== 1 || tb > nt) problems.push(`toast: count ${n}, bottom ${tb} vs nav top ${nt}`);
  if (!/Skipped/.test(text)) problems.push(`toast text "${text}" doesn't match the action`);
  await shot(page, "toast", false);
  await page.waitForTimeout(2200);
  if (await page.$(".toast")) problems.push("toast still visible after 2 s");
  await ctx.close();
}

await browser.close();
console.log(`${shots.length} screenshots → ${OUT}`);
for (const p of problems) console.log("PROBLEM", p);
console.log(problems.length ? "VISUAL CHECK: PROBLEMS FOUND" : "VISUAL CHECK PASSED");
process.exit(problems.length ? 1 : 0);
