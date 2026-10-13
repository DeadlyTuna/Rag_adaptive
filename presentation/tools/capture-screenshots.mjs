// Captures every feature of the Adaptive RAG website for the presentation deck.
// Usage: node capture.mjs <outDir> [parts=L,C,M,R,K,S]
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const OUT = process.argv[2];
const PARTS = (process.argv[3] || "L,C,M,R,K,S").split(",");
const WEB = "http://localhost:3000";
const API = "http://localhost:8000";
const SWAGGER = "/tmp/claude-0/-home-user-Rag-adaptive/ad14dabd-f438-5912-9a6b-1de85eba61ab/scratchpad/swagger/pkg/package";
const VIEW = { width: 1600, height: 1000 };
const DSF = 1.5;
mkdirSync(OUT, { recursive: true });

const manifest = {}; // name -> { file, w, h, boxes: {label: [x,y,w,h] as fractions} }
const failures = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

async function newPage() {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => log("pageerror:", String(e).slice(0, 200)));
  return { ctx, page };
}

/** Screenshot the viewport (or a locator) and record element boxes as fractions of the image. */
async function shot(page, name, opts = {}) {
  try {
    const file = `${name}.jpg`;
    let clip = null;
    if (opts.el) {
      const el = typeof opts.el === "string" ? page.locator(opts.el).first() : opts.el;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(opts.settle ?? 300);
      clip = await el.boundingBox();
      if (opts.pad && clip) {
        const p = opts.pad;
        clip = { x: Math.max(0, clip.x - p), y: Math.max(0, clip.y - p), width: clip.width + 2 * p, height: clip.height + 2 * p };
      }
      await page.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 90, clip });
    } else if (opts.full) {
      await page.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 90, fullPage: true });
    } else {
      await page.screenshot({ path: `${OUT}/${file}`, type: "jpeg", quality: 90 });
    }
    const frame = clip || (opts.full
      ? { x: 0, y: 0, width: VIEW.width, height: await page.evaluate(() => document.documentElement.scrollHeight) }
      : { x: 0, y: 0, width: VIEW.width, height: VIEW.height });
    const boxes = {};
    for (const [label, loc] of Object.entries(opts.boxes || {})) {
      try {
        const l = typeof loc === "string" ? page.locator(loc).first() : loc;
        const b = await l.boundingBox({ timeout: 1500 });
        if (!b) continue;
        const sy = opts.full ? await page.evaluate(() => scrollY) : 0;
        boxes[label] = [(b.x - frame.x) / frame.width, (b.y + sy - frame.y) / frame.height, b.width / frame.width, b.height / frame.height].map((v) => +v.toFixed(4));
      } catch { /* box optional */ }
    }
    manifest[name] = { file, w: Math.round(frame.width), h: Math.round(frame.height), boxes, note: opts.note || "" };
    log("shot", name, Object.keys(boxes).length ? `(${Object.keys(boxes).length} boxes)` : "");
  } catch (e) {
    failures.push(`${name}: ${String(e).slice(0, 160)}`);
    log("FAILED", name, String(e).slice(0, 160));
  }
}

async function step(page, name, fn) {
  try { await fn(); } catch (e) { failures.push(`${name}: ${String(e).slice(0, 200)}`); log("FAILED step", name, String(e).slice(0, 200)); }
}

const hideToasts = (page, hide) => page.evaluate((h) => {
  let s = document.getElementById("__hide_toasts");
  if (!s) { s = document.createElement("style"); s.id = "__hide_toasts"; document.head.appendChild(s); }
  s.textContent = h ? 'ol[aria-label="Memory notifications"]{display:none!important}' : "";
}, hide);

// ===================================================================================== LANDING
async function landing() {
  const { ctx, page } = await newPage();
  await page.goto(WEB + "/");
  await page.waitForSelector('canvas[role="img"]', { timeout: 30000 });
  const centre = (id, f = 0.5) => page.evaluate(([id, f]) => {
    const el = document.getElementById(id);
    const top = el.getBoundingClientRect().top + scrollY;
    scrollTo(0, Math.max(0, top + el.offsetHeight * f - innerHeight / 2));
  }, [id, f]);

  await step(page, "hero", async () => {
    await page.getByText("75%, from Regulations §3.1.").waitFor({ timeout: 15000 });
    await sleep(600);
    await shot(page, "L01-hero-before", { boxes: { card: page.getByText("live demo").locator("xpath=ancestor::div[contains(@class,'rounded')][1]") } });
    await page.getByText("your department’s rule", { exact: false }).waitFor({ timeout: 15000 });
    await sleep(1400);
    await shot(page, "L02-hero-after");
  });
  await step(page, "problem", async () => { await centre("problem"); await sleep(3200); await shot(page, "L03-problem"); });
  await step(page, "sorter", async () => {
    for (let k = 0; k <= 5; k++) {
      await page.evaluate((k) => {
        const el = document.getElementById("remember");
        const top = el.getBoundingClientRect().top + scrollY;
        scrollTo(0, top + (el.offsetHeight - innerHeight) * ((k + 0.5) / 7.4));
      }, k);
      await sleep(1400);
      if (k === 0) await shot(page, "L04-sorter-first");
      if (k === 3) await shot(page, "L05-sorter-mid");
    }
    await page.evaluate(() => {
      const el = document.getElementById("remember");
      const top = el.getBoundingClientRect().top + scrollY;
      scrollTo(0, top + (el.offsetHeight - innerHeight) * 0.95);
    });
    await sleep(1600);
    await shot(page, "L06-sorter-done");
  });
  await step(page, "correct", async () => { await centre("correct"); await sleep(3800); await shot(page, "L07-correct"); });
  await step(page, "rank", async () => {
    await centre("rank"); await sleep(1300); await shot(page, "L08-rank-ping");
    await sleep(2000); await shot(page, "L09-rank");
    await page.getByRole("button", { name: "Similarity only" }).click(); await sleep(1300);
    await shot(page, "L10-rank-similarity-only");
    await page.getByRole("button", { name: "Learned weights" }).click(); await sleep(600);
  });
  await step(page, "loop", async () => { await centre("loop"); await sleep(2800); await shot(page, "L11-loop"); });
  await step(page, "architecture", async () => {
    await centre("architecture", 0.62); await sleep(2000); await shot(page, "L12-architecture");
    await page.getByRole("button", { name: "Adaptive retriever" }).hover(); await sleep(600);
    await shot(page, "L13-architecture-hover");
  });
  await step(page, "cta", async () => {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await sleep(2600);
    await shot(page, "L14-cta");
  });
  await ctx.close();
}

// ===================================================================================== CONSOLE
async function waitIdle(page, nextId) {
  if (nextId) await page.locator(`[data-step="${nextId}"]:not([disabled])`).waitFor({ timeout: 60000 });
  await sleep(2000);
}
const userArticle = (page, text) => page.locator('section[aria-label="Conversation"] article', { hasText: text }).last();
const asstArticle = (page, k) => page.locator('section[aria-label="Conversation"] article', { hasText: "Was this helpful?" }).nth(k);

async function consolePart(page) {
  await page.goto(WEB + "/console");
  await page.locator('section[aria-label="Conversation"]').waitFor({ timeout: 30000 });
  await page.getByText(/^Live API ·/).waitFor({ timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const consoleBoxes = () => ({
    transcript: 'section[aria-label="Conversation"]',
    inspector: 'aside[aria-label="Inspector"]',
    map: 'aside[aria-label="Inspector"] section >> nth=0',
    chips: '[data-step="ask"] >> xpath=..',
    clock: '[role="group"][aria-label="Demo clock"]',
    rail: 'nav[aria-label="Main"]',
  });

  await step(page, "empty", async () => {
    await page.getByText("Ask it something. Then correct it.").waitFor({ timeout: 10000 });
    await shot(page, "C01-console-empty", { boxes: consoleBoxes() });
    await shot(page, "C02-script-chips", { el: page.locator('[data-step="ask"]').locator("xpath=../.."), pad: 6 });
  });

  // step 1 — ask
  await step(page, "ask", async () => {
    await page.locator('[data-step="ask"]').click();
    await page.locator('ol[aria-label="Pipeline progress"]').waitFor({ timeout: 10000 });
    await sleep(400);
    await shot(page, "C03-pipeline-classify", { el: page.locator('ol[aria-label="Pipeline progress"]').locator("xpath=.."), pad: 8 });
    await page.getByText("Searching the knowledge base and memory…").waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(500);
    await shot(page, "C04-ask-retrieving");
    await waitIdle(page, "correct");
    await shot(page, "C05-ask-answer", { boxes: { ...consoleBoxes(), answer: asstArticle(page, 0), pill: page.getByRole("button", { name: /Question · not stored/ }).first(), cite: 'button[aria-label="Source 1"]', retrieved: 'aside[aria-label="Inspector"] section >> nth=1' } });
    await page.getByRole("button", { name: /Question · not stored/ }).first().click(); await sleep(700);
    await shot(page, "C06-question-pill", { el: userArticle(page, "What is the minimum attendance requirement?"), pad: 10 });
    await page.getByRole("button", { name: /Question · not stored/ }).first().click(); await sleep(300);
  });

  // step 2 — correct
  await step(page, "correct", async () => {
    await page.locator('[data-step="correct"]').click();
    await userArticle(page, "Our department changed it").locator('ul[aria-label="Class probabilities"]').waitFor({ timeout: 15000 });
    await sleep(900);
    await shot(page, "C07-correct-classifying", { boxes: { pipeline: 'ol[aria-label="Pipeline progress"]' } });
    await page.locator('ol[aria-label="Memory notifications"] li', { hasText: "Previous fact corrected" }).waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(500);
    await shot(page, "C08-correct-memory-update", { boxes: { toast: 'ol[aria-label="Memory notifications"] li', map: 'aside[aria-label="Inspector"] section >> nth=0' } });
    await waitIdle(page, "fat");
    await hideToasts(page, true);
    await shot(page, "C09-classifier-strip", { el: userArticle(page, "Our department changed it"), pad: 10,
      boxes: { probs: userArticle(page, "Our department changed it").locator('ul[aria-label="Class probabilities"]'),
               spans: userArticle(page, "Our department changed it").locator('span[title="Value"]').first(),
               conflict: page.getByText(/Conflicts with/).last(),
               opcard: page.locator('section[aria-label="Conversation"] button', { hasText: "Minimum attendance = 80%" }).last() } });
    await shot(page, "C10-correct-answer", { boxes: consoleBoxes() });
    await hideToasts(page, false);
  });

  // step 3 — fat
  await step(page, "fat", async () => {
    await page.locator('[data-step="fat"]').click();
    await page.locator(".is-streaming").waitFor({ timeout: 20000 }).catch(() => {});
    await sleep(500);
    await shot(page, "C11-fat-streaming");
    await waitIdle(page, "concise");
    await hideToasts(page, true);
    await shot(page, "C12-fat-answer", { boxes: { ...consoleBoxes(), answer: asstArticle(page, 2), retrieved: 'aside[aria-label="Inspector"] section >> nth=1', override: page.getByText(/Overridden for minimum attendance/).first() } });
    await shot(page, "C13-inspector-retrieved", { el: 'aside[aria-label="Inspector"] section >> nth=1', pad: 4 });
    await shot(page, "C14-inspector-map", { el: 'aside[aria-label="Inspector"] section >> nth=0', pad: 4 });
    // cross-highlight by hovering a citation chip
    await page.locator('button[aria-label="Source 1"]').last().hover(); await sleep(600);
    await shot(page, "C15-citation-hover", { boxes: { chip: page.locator('button[aria-label="Source 1"]').last(), map: 'aside[aria-label="Inspector"] section >> nth=0', retrieved: 'aside[aria-label="Inspector"] section >> nth=1' } });
    // score bar tooltip
    const bar = page.locator('aside[aria-label="Inspector"] [role="img"][aria-label^="Score "]').first();
    await bar.locator("span").first().hover().catch(() => {}); await sleep(600);
    await shot(page, "C16-scorebar-tooltip", { el: 'aside[aria-label="Inspector"] section >> nth=1', pad: 4 });
    await page.mouse.move(10, 500);
    await shot(page, "C17-inspector-weights", { el: 'aside[aria-label="Inspector"] section >> nth=2', pad: 4 });
    await hideToasts(page, false);
  });

  // step 4 — concise
  await step(page, "concise", async () => {
    await page.locator('[data-step="concise"]').click();
    await waitIdle(page, "exam");
    await hideToasts(page, true);
    await shot(page, "C18-concise", { el: userArticle(page, "I prefer concise answers."), pad: 10 });
    await shot(page, "C19-concise-full");
    await hideToasts(page, false);
  });
  // step 5 — exam
  await step(page, "exam", async () => {
    await page.locator('[data-step="exam"]').click();
    await waitIdle(page, "math");
    await hideToasts(page, true);
    await shot(page, "C20-exam", { el: userArticle(page, "I have a DBMS exam tomorrow."), pad: 10 });
    await shot(page, "C21-exam-answer", { el: asstArticle(page, 4), pad: 10 });
    await hideToasts(page, false);
  });
  // step 6 — math
  await step(page, "math", async () => {
    await page.locator('[data-step="math"]').click();
    await waitIdle(page, "mine");
    await hideToasts(page, true);
    await shot(page, "C22-math-full");
    await hideToasts(page, false);
  });
  // step 7 — mine
  await step(page, "mine", async () => {
    await page.locator('[data-step="mine"]').click();
    await waitIdle(page, "eligible");
    await hideToasts(page, true);
    await shot(page, "C23-mine", { el: userArticle(page, "My attendance is 78%."), pad: 10 });
    await hideToasts(page, false);
  });
  // step 8 — eligible
  await step(page, "eligible", async () => {
    await page.locator('[data-step="eligible"]').click();
    await waitIdle(page, "jump");
    await hideToasts(page, true);
    await shot(page, "C24-eligible-full", { boxes: { ...consoleBoxes(), answer: page.locator('section[aria-label="Conversation"] article', { hasText: "Not yet." }).last(), retrieved: 'aside[aria-label="Inspector"] section >> nth=1' } });
    await shot(page, "C25-eligible-answer", { el: page.locator('section[aria-label="Conversation"] article', { hasText: "Not yet." }).last(), pad: 10 });
    // source drawer from a citation chip
    await page.locator('button[aria-label="Source 2"]').last().click(); await sleep(1000);
    await shot(page, "C26-citation-drawer");
    await page.keyboard.press("Escape"); await sleep(600);
  });

  // feedback — helpful on the first answer, not helpful → wrong source on the eligibility answer
  await step(page, "feedback", async () => {
    const first = asstArticle(page, 0);
    await first.scrollIntoViewIfNeeded();
    await first.getByRole("button", { name: "Helpful", exact: true }).click();
    await page.getByText("Thanks — the sources it cited", { exact: false }).first().waitFor({ timeout: 10000 });
    await sleep(1000);
    await shot(page, "C27-feedback-helpful", { el: first, pad: 10 });
    const a = page.locator('section[aria-label="Conversation"] article', { hasText: "Not yet." }).last();
    await a.scrollIntoViewIfNeeded();
    await a.getByRole("button", { name: "Not helpful" }).click(); await sleep(600);
    await shot(page, "C28-feedback-reason", { el: a, pad: 10 });
    await a.getByRole("button", { name: "Wrong source" }).click(); await sleep(600);
    await a.locator("li button").nth(2).hover(); await sleep(400);
    await shot(page, "C29-feedback-source", { el: a, pad: 10 });
    await a.locator("li button").nth(2).click();
    await page.getByText("Lowered trust in", { exact: false }).last().waitFor({ timeout: 10000 });
    await sleep(1200);
    await hideToasts(page, true);
    await shot(page, "C30-feedback-result", { el: a, pad: 10 });
    await shot(page, "C31-weights-after-feedback", { el: 'aside[aria-label="Inspector"] section >> nth=2', pad: 4 });
    await hideToasts(page, false);
  });

  // step 9 — jump (time travel)
  await step(page, "jump", async () => {
    await page.locator('[data-step="jump"]').click();
    await page.locator('ol[aria-label="Memory notifications"] li', { hasText: "Temporary memory expired" }).waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(900);
    await shot(page, "C32-jump", { boxes: { clock: '[role="group"][aria-label="Demo clock"]', toast: 'ol[aria-label="Memory notifications"] li', map: 'aside[aria-label="Inspector"] section >> nth=0' } });
    await shot(page, "C33-clock", { el: '[role="group"][aria-label="Demo clock"]', pad: 8 });
    await sleep(6500); // let toasts clear
  });

  // command palette
  await step(page, "palette", async () => {
    await page.mouse.click(700, 300);
    await page.keyboard.press("Control+KeyK");
    await page.locator("[cmdk-dialog]").waitFor({ timeout: 5000 });
    await sleep(500);
    await shot(page, "C34-palette");
    await page.locator("[cmdk-input]").fill("attendance"); await sleep(600);
    await shot(page, "C35-palette-search");
    await page.keyboard.press("Escape"); await sleep(400);
  });
  await step(page, "shell", async () => {
    await shot(page, "S01-status-strip", { el: "header.sticky", pad: 0 });
    await shot(page, "S02-rail", { el: 'nav[aria-label="Main"]', pad: 0 });
  });
}

// ===================================================================================== MEMORY
async function memoryPart(page) {
  await page.goto(WEB + "/memory");
  await page.getByRole("heading", { level: 1, name: "Everything it has learned" }).waitFor({ timeout: 20000 });
  await page.locator('section:has(h2:has-text("Knowledge terrain")) canvas').waitFor({ timeout: 20000 });
  await sleep(4000);
  const terrain = 'section:has(h2:has-text("Knowledge terrain"))';
  await step(page, "memory-overview", async () => {
    await shot(page, "M01-memory-overview", { boxes: { timeline: '[role="slider"][aria-label="Show memory as of"]', kpis: 'div.panel:has(p:text-is("Passages indexed"))', terrain, activity: 'section:has(h2:has-text("Activity"))', toggle: '[role="radiogroup"][aria-label="Map view"]' } });
    await shot(page, "M02-terrain-3d", { el: terrain, pad: 0, boxes: {
      memLabel: '.terrain-label[data-kind="memory"]', ghost: '.terrain-label[data-kind="ghost"]', legend: page.getByText("Learned memory").first(), caption: page.getByText("Height = how strongly", { exact: false }).first() } });
    await shot(page, "M03-kpis", { el: page.locator('div.panel:has(p:text-is("Passages indexed"))').locator("xpath=.."), pad: 4 });
    await shot(page, "M04-activity", { el: 'section:has(h2:has-text("Activity"))', pad: 0 });
  });
  await step(page, "memory-2d", async () => {
    await page.getByRole("radio", { name: "2-D map", exact: true }).click(); await sleep(700);
    await shot(page, "M05-terrain-morph", { el: terrain, pad: 0 });
    await sleep(1600);
    await shot(page, "M06-terrain-2d", { el: terrain, pad: 0 });
    await page.getByRole("radio", { name: "3-D relief", exact: true }).click(); await sleep(2000);
  });
  await step(page, "memory-hover", async () => {
    const card = page.locator('section:has(h2:has-text("Memory bank")) li button', { hasText: "Minimum attendance" }).first();
    await card.scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollTo(0, 380)); await sleep(500);
    await card.hover().catch(() => {}); await sleep(900);
    await shot(page, "M07-hover-link");
    await page.mouse.move(5, 5);
  });
  await step(page, "memory-bank", async () => {
    await shot(page, "M08-memory-bank", { el: 'section:has(h2:has-text("Memory bank"))', pad: 0 });
    await shot(page, "M09-facts-changed", { el: 'section:has(h2:has-text("Facts that changed"))', pad: 0 });
    await page.getByRole("radiogroup", { name: "Status" }).getByRole("radio", { name: "Replaced & expired" }).click(); await sleep(900);
    await shot(page, "M10-bank-replaced-expired", { el: 'section:has(h2:has-text("Memory bank"))', pad: 0 });
    await page.getByRole("radiogroup", { name: "Status" }).getByRole("radio", { name: "Current" }).click(); await sleep(500);
  });
  await step(page, "memory-drawer", async () => {
    const card = page.locator('section:has(h2:has-text("Memory bank")) li button', { hasText: "Minimum attendance" }).first();
    await card.click(); await page.getByRole("dialog").waitFor(); await sleep(1100);
    await shot(page, "M11-drawer-correction");
    const svg = page.getByRole("dialog").locator('svg[aria-label^="Strength "]');
    await svg.scrollIntoViewIfNeeded().catch(() => {});
    const b = await svg.boundingBox();
    if (b) { await page.mouse.move(b.x + b.width * 0.7, b.y + 60); await sleep(500); }
    await shot(page, "M12-forgetting-curve", { el: page.getByRole("dialog").locator("figure").first(), pad: 8 });
    await page.keyboard.press("Escape"); await sleep(700);
    // the expired exam memory
    await page.getByRole("radiogroup", { name: "Status" }).getByRole("radio", { name: "Replaced & expired" }).click(); await sleep(700);
    const exam = page.locator('section:has(h2:has-text("Memory bank")) li button', { hasText: "DBMS exam" }).first();
    await exam.click(); await page.getByRole("dialog").waitFor(); await sleep(1100);
    await shot(page, "M13-drawer-expired");
    await page.keyboard.press("Escape"); await sleep(600);
    await page.getByRole("radiogroup", { name: "Status" }).getByRole("radio", { name: "Current" }).click(); await sleep(500);
  });
  await step(page, "memory-rewind", async () => {
    await page.evaluate(() => scrollTo(0, 0)); await sleep(400);
    const s = page.getByRole("slider", { name: "Show memory as of" });
    await s.focus(); await page.keyboard.press("Home");
    for (let i = 0; i < 6; i++) { await page.keyboard.press("ArrowRight"); await sleep(60); }
    await sleep(2500);
    await shot(page, "M14-rewind", { boxes: { banner: page.getByText("Showing memory as it was on", { exact: false }).first(), timeline: '[role="slider"][aria-label="Show memory as of"]' } });
    await page.getByRole("button", { name: "Back to now" }).click().catch(() => {}); await sleep(1500);
    await page.getByRole("button", { name: "Replay how memory evolved" }).click(); await sleep(4500);
    await shot(page, "M15-replay");
    await page.getByRole("button", { name: "Pause replay" }).click().catch(() => {});
    await page.getByRole("button", { name: "Back to now" }).click().catch(() => {}); await sleep(1500);
  });
}

// ===================================================================================== RETRIEVAL
async function retrievalPart(page) {
  await page.goto(WEB + "/retrieval");
  await page.getByRole("heading", { level: 1, name: "Ranked by more than similarity" }).waitFor({ timeout: 20000 });
  const ranking = page.locator("section.panel").filter({ has: page.locator("h2", { hasText: /^ranking$/i }) });
  await ranking.locator("ol > li").first().waitFor({ timeout: 20000 });
  await sleep(2000);
  await step(page, "lab-overview", async () => {
    await shot(page, "R01-lab-overview", { boxes: { formula: 'p[aria-label^="score equals"]', modes: '[role="radiogroup"][aria-label="Weights"]', sliders: "#w-S", ranking } });
  });
  await step(page, "lab-manual", async () => {
    await page.getByRole("radio", { name: "Try your own" }).click(); await sleep(400);
    await page.locator("#w-S").evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, "0.12");
    await sleep(1600);
    await shot(page, "R02-lab-manual", { boxes: { formula: 'p[aria-label^="score equals"]', deltas: '[aria-label^="up "]', apply: page.getByRole("button", { name: "Apply to assistant" }) } });
    await page.getByRole("button", { name: "Show factor table" }).click(); await sleep(800);
    await shot(page, "R03-factor-table", { el: ranking, pad: 0 });
    await page.getByRole("button", { name: "Show bars" }).click(); await sleep(400);
    await page.getByRole("radio", { name: "Learned" }).click(); await sleep(800);
  });
  await step(page, "lab-query", async () => {
    await page.getByRole("button", { name: "When does the library close?" }).click(); await sleep(2200);
    await shot(page, "R04-query-library", { el: ranking, pad: 0 });
    await page.getByRole("button", { name: "When can I write my FAT?" }).click(); await sleep(1500);
  });
  await step(page, "lab-learning", async () => {
    const curve = page.locator("section.panel").filter({ has: page.locator("h2", { hasText: /how feedback/i }) });
    await curve.scrollIntoViewIfNeeded(); await sleep(800);
    const svg = page.locator('svg[aria-label^="Weights over"]');
    const box = await svg.boundingBox();
    if (box) { await svg.hover({ position: { x: box.width - 90, y: 100 } }).catch(() => {}); await sleep(500); }
    await shot(page, "R05-learning-curve", { el: curve, pad: 0 });
    const rel = page.locator("section.panel").filter({ has: page.locator("h2", { hasText: /^source reliability/i }) });
    await shot(page, "R06-reliability", { el: rel, pad: 0 });
    await page.mouse.move(5, 5);
  });
  await step(page, "lab-classifier", async () => {
    const cls = page.locator("section.panel").filter({ has: page.locator("h2", { hasText: /^memory classifier/i }) });
    await cls.scrollIntoViewIfNeeded();
    await page.locator("#cls-input").fill("The pass mark is now 45%.");
    await page.getByText("Conflicts with", { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {});
    await page.getByRole("table", { name: /Confusion matrix/ }).waitFor({ timeout: 20000 }).catch(() => {});
    await sleep(1500);
    await shot(page, "R07-classifier-trained", { el: cls, pad: 0, boxes: { input: "#cls-input", probs: 'ul[aria-label="Class probabilities"]', matrix: page.getByRole("table", { name: /Confusion matrix/ }), toggle: '[role="radiogroup"][aria-label="Classifier"]' } });
    await page.getByRole("radio", { name: "Rules" }).click();
    await page.getByText(/^Misses:/).waitFor({ timeout: 20000 }).catch(() => {});
    await page.locator("#cls-input").fill("Actually, your previous answer was wrong.");
    await sleep(1800);
    await shot(page, "R08-classifier-rules", { el: cls, pad: 0 });
    await page.getByRole("radio", { name: "Trained model" }).click(); await sleep(500);
  });
}

// ===================================================================================== KNOWLEDGE
async function knowledgePart(page) {
  await page.goto(WEB + "/knowledge");
  await page.getByRole("heading", { level: 1, name: "The documents it answers from" }).waitFor({ timeout: 20000 });
  await sleep(2500);
  const passages = page.locator("section.panel", { has: page.getByRole("heading", { name: /^Passages · / }) });
  const mapPanel = page.locator("section.panel", { has: page.getByRole("heading", { name: "Where it sits on the map" }) });
  await step(page, "knowledge-overview", async () => {
    await shot(page, "K01-knowledge-overview", { boxes: { drop: page.getByRole("button", { name: "Add the sample CSE circular" }), docs: page.getByRole("button", { name: /Academic Regulations 2024/ }), passages, map: mapPanel } });
    await shot(page, "K02-map-panel", { el: mapPanel, pad: 0 });
    const row = passages.getByRole("button").filter({ hasText: "Minimum attendance" }).first();
    await row.scrollIntoViewIfNeeded(); await sleep(400);
    await shot(page, "K03-passage-override", { el: row, pad: 6, boxes: { finger: row.getByRole("img", { name: "Embedding fingerprint" }), override: row.getByText(/^Overridden for/) } });
    await shot(page, "K04-passages", { el: passages, pad: 0 });
    await page.evaluate(() => scrollTo(0, 0)); await sleep(500);
  });
  await step(page, "knowledge-ingest", async () => {
    await page.getByRole("button", { name: "Add the sample CSE circular" }).click();
    await sleep(650);
    await shot(page, "K05-ingest-split", { el: 'main [aria-live="polite"]', pad: 8, settle: 0 });
    await sleep(950);
    await shot(page, "K06-ingest-embed", { el: 'main [aria-live="polite"]', pad: 8, settle: 0 });
    await page.getByText(/^Indexed · \d+ passages$/).waitFor({ timeout: 10000 });
    await sleep(400);
    await shot(page, "K07-ingest-indexed", { el: 'main [aria-live="polite"]', pad: 8, settle: 0 });
    await page.getByRole("heading", { name: "Passages · CSE Department Circular 2025/14" }).waitFor({ timeout: 15000 });
    await sleep(1500);
    await shot(page, "K08-ingest-done", { boxes: { toast: 'ol[aria-label="Memory notifications"] li', map: mapPanel } });
  });
}

// ===================================================================================== SWAGGER
async function swaggerPart() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  await page.route("https://cdn.jsdelivr.net/**", (route) => {
    const css = route.request().url().endsWith(".css");
    route.fulfill({ body: readFileSync(`${SWAGGER}/${css ? "swagger-ui.css" : "swagger-ui-bundle.js"}`), contentType: css ? "text/css" : "application/javascript" });
  });
  await page.route("https://fastapi.tiangolo.com/**", (r) => r.abort());
  await page.goto(API + "/docs");
  await page.waitForSelector(".opblock", { timeout: 30000 });
  await sleep(800);
  await shot(page, "S03-swagger", { full: true });
  await ctx.close();
}

// ===================================================================================== RUN
const t0 = Date.now();
if (PARTS.includes("L")) { log("== landing"); await landing(); }
if (["C", "M", "R", "K", "S"].some((p) => PARTS.includes(p))) {
  await fetch(API + "/api/reset", { method: "POST" });
  const { ctx, page } = await newPage();
  if (PARTS.includes("C")) { log("== console"); await consolePart(page); }
  if (PARTS.includes("M")) { log("== memory"); await memoryPart(page); }
  if (PARTS.includes("R")) { log("== retrieval"); await retrievalPart(page); }
  if (PARTS.includes("K")) { log("== knowledge"); await knowledgePart(page); }
  await ctx.close();
}
if (PARTS.includes("S")) { log("== swagger"); await swaggerPart(); }
await browser.close();
let prev = {};
try { prev = JSON.parse(readFileSync(`${OUT}/manifest.json`, "utf8")); } catch {}
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ ...prev, ...manifest }, null, 1));
console.log(`\n${Object.keys(manifest).length} shots in ${Math.round((Date.now() - t0) / 1000)} s, ${failures.length} failures`);
for (const f of failures) console.log("  ✗", f);
