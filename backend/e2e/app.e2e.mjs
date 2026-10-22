// End-to-end check of the phone app against a running Worker (wrangler dev), at iPhone size.
//
//   cd backend && npx wrangler dev --port 8787        (with .dev.vars)
//   node e2e/app.e2e.mjs http://localhost:8787 <out-dir>
//
// Needs Playwright (global install is fine: NODE_PATH=$(npm root -g)). Writes screenshots to <out-dir>.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

// require() honours NODE_PATH, so a global Playwright install works without adding a dependency.
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] || "http://localhost:8787";
const OUT = process.argv[3] || "e2e-out";
mkdirSync(OUT, { recursive: true });

const vars = Object.fromEntries(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
  .split("\n").filter((l) => /^\w+=/.test(l)).map((l) => l.split("=")));
const INGEST = vars.INGEST_TOKEN, DEVICE = vars.DEVICE_TOKEN;

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures.push(name);
};
const dashboard = async () => (await fetch(`${BASE}/api/dashboard`, { headers: { authorization: `Bearer ${DEVICE}` } })).json();
const config = async () => (await fetch(`${BASE}/api/config`, { headers: { authorization: `Bearer ${INGEST}` } })).json();

// Seed a Health sync so the metric cards have data.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
await fetch(`${BASE}/api/ingest`, {
  method: "POST", headers: { authorization: `Bearer ${INGEST}`, "content-type": "application/json" },
  body: JSON.stringify({ date: today, steps: 8432, active_kcal: 512, nutrition: { kcal: 1850, protein_g: 120 },
    sleep_samples: [{ start: `${today}T00:10:00+02:00`, end: `${today}T07:22:00+02:00`, value: "Core" }] }),
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const problems = [];
// Network failures we cause on purpose (wrong token, aborted request) also log "Failed to load resource".
page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(`${BASE}/app/`);
await page.screenshot({ path: `${OUT}/0_login.png` });

// Wrong token first, then the right one.
await page.fill("input[name=token]", "definitely-not-the-token-123456");
await page.click("button[type=submit]");
await page.waitForSelector(".err:has-text('rejected')");
check("wrong token shows an error", true);
await page.fill("input[name=token]", INGEST);
await page.click("button[type=submit]");
await page.waitForSelector(".hero");
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/1_today.png`, fullPage: true });

const planned = (await dashboard()).gym;
const tappable = await page.$$eval(".btn, .nav button", (els) => els.every((e) => e.getBoundingClientRect().height >= 44));
check("touch targets ≥ 44px", tappable);

// I trained → Push → 55 min (only some of the push muscles)
if (planned.status === "pending") {
  await page.click("button:has-text('I trained')");
  await page.waitForSelector(".sheet");
  await page.click(".sheet .chip:has-text('PUSH')");
  await page.click(".sheet .chip:has-text('Side delts')"); // untick
  await page.click("button[aria-label='5 minutes less']");
  await page.fill(".sheet input.input", "PR bench 80kg");
  await page.screenshot({ path: `${OUT}/2_sheet.png` });
  await page.click("button:has-text('Save session')");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/3_celebrate.png` });
  await page.waitForSelector(".status.done");
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/4_done.png`, fullPage: true });
  const d = await dashboard();
  check("dashboard shows done", d.gym.status === "done", JSON.stringify(d.gym));
  check("dashboard has trained muscles", JSON.stringify(d.gym.muscles) === JSON.stringify(["chest", "front_delts", "triceps"]), JSON.stringify(d.gym.muscles));
  check("dashboard has 55 min", d.gym.done_min === 55, String(d.gym.done_min));
} else {
  check(`today is a ${planned.status} day — run on a planned gym day to test 'I trained'`, true);
}

// BP
await page.click(".nav button:has-text('BP')");
await page.fill("input[name=sys]", "128");
await page.fill("input[name=dia]", "82");
await page.fill("input[name=pulse]", "64");
await page.click("button:has-text('Save reading')");
await page.waitForSelector(".toast.ok:has-text('Reading saved')");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/5_bp.png`, fullPage: true });
const bp = (await dashboard()).bp;
check("dashboard shows the BP reading", bp?.sys === 128 && bp?.dia === 82 && bp?.pulse === 64, JSON.stringify(bp));

// Plan: change tomorrow's split
const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const tomorrowKey = weekdays[(new Date(`${today}T12:00:00Z`).getUTCDay() + 1) % 7];
const before = (await config()).schedule[tomorrowKey];
const target = before === "legs" ? "pull" : "legs";
await page.click(".nav button:has-text('Plan')");
await page.waitForSelector(".tile");
const idx = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(tomorrowKey);
await page.locator(".tile").nth(idx).click();
await page.waitForSelector(".sheet .option");
await page.click(`.sheet .option:has-text('${target.toUpperCase()}')`);
await page.waitForSelector(".toast.ok:has-text('is now')");
await page.screenshot({ path: `${OUT}/6_plan.png`, fullPage: true });
const after = (await config()).schedule[tomorrowKey];
check(`plan edit changes tomorrow (${tomorrowKey}: ${before} → ${after})`, after === target);

// History
await page.click(".nav button:has-text('History')");
await page.waitForSelector(".cell");
await page.screenshot({ path: `${OUT}/7_history.png`, fullPage: true });

// Undo the session again (keeps the dev data tidy) and check rollback on a failed request.
await page.click(".nav button:has-text('Today')");
// tick a habit, and check the dashboard counts it
const doneBefore = (await dashboard()).score.done;
await page.click(".habit:has-text('Read something')");
await page.waitForTimeout(500);
check("ticking a habit raises the score", (await dashboard()).score.done === doneBefore + 1);
await ctx.route("**/api/gym", (r) => r.abort());
const statusBefore = await page.textContent(".status");
if (await page.$("button:has-text('Undo')")) {
  await page.click("button:has-text('Undo')");
  await page.waitForSelector(".toast.error");
  check("failed request rolls back and shows a toast", (await page.textContent(".status")) === statusBefore);
  await ctx.unroute("**/api/gym");
  await page.click("button:has-text('Undo')");
  await page.waitForTimeout(500);
}

check("no console errors or CSP violations", problems.length === 0, problems.join(" | "));
await browser.close();
console.log(failures.length ? `E2E FAILED (${failures.length})` : "E2E PASSED");
process.exit(failures.length ? 1 : 0);
