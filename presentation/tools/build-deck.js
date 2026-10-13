// Builds Adaptive-RAG-Feature-Tour.pptx — a full tour of the website, in the site's own palette.
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const lu = require("react-icons/lu");
const fs = require("fs");
const path = require("path");
const { applyTheme } = require("/root/.claude/skills/synced/403d2280-4a90-4b1a-b67c-8d3ae48e20b8_ed66a463-5b9c-4748-91d2-f336d22dfe54/pptx/scripts/apply_theme.js");

const SP = "/tmp/claude-0/-home-user-Rag-adaptive/ad14dabd-f438-5912-9a6b-1de85eba61ab/scratchpad";
const SHOTS = `${SP}/shots/run1`;
const DIR = `${SP}/deck`;
const OUT = process.argv[2] || `${DIR}/Adaptive-RAG-Feature-Tour.pptx`;

// Website palette (frontend/app/globals.css). A dark deck, so the "dk" slots hold the light text
// colours and the "lt" slots the dark backgrounds: new slides and text boxes in PowerPoint then
// default to light text on the dark background.
const HEX = {
  foam: "E6F2EE", kelp: "86A9A4", abyss: "0A2327", trench: "0F2E33", shelf: "1F4B51",
  rhodamine: "FF6B93", sodium: "FFC14D", glacier: "8FCBFF", vizR: "2FA284", vizC: "3A80C8",
  vizS: "C18500", vizI: "D95479", flare: "FF8A7A",
};
const THEME = {
  name: "Adaptive RAG — Sounding",
  headFontFace: "Arial",
  bodyFontFace: "Calibri",
  colors: {
    dk1: HEX.foam, lt1: HEX.abyss, dk2: HEX.kelp, lt2: HEX.trench,
    accent1: HEX.rhodamine, accent2: HEX.sodium, accent3: HEX.glacier,
    accent4: HEX.vizR, accent5: HEX.vizC, accent6: HEX.shelf,
    hlink: HEX.glacier, folHlink: HEX.kelp,
  },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "Adaptive RAG — feature tour";
pres.subject = "Every feature of the Adaptive RAG website, with screenshots";
pres.author = "Adaptive RAG project";
const C = pres.SchemeColor;
const T = { text: C.text1, muted: C.text2, bg: C.background1, card: C.background2, pink: C.accent1, amber: C.accent2, blue: C.accent3, green: C.accent4, cblue: C.accent5, line: C.accent6 };
const W = 13.333, MX = 0.55, TOP = 1.5, BOTTOM = 6.85;

// ------------------------------------------------------------------ layouts
pres.defineSlideMaster({
  title: "TITLE",
  background: { color: T.bg },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: MX, y: 1.25, w: 6.2, h: 0.35, fontSize: 12, bold: true, color: T.pink, charSpacing: 3, margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 1.65, w: 6.3, h: 1.7, fontSize: 48, bold: true, color: T.text, margin: 0, valign: "bottom", align: "left" }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: MX, y: 3.5, w: 6.1, h: 3.2, fontSize: 18, color: T.muted, margin: 0, valign: "top" }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: T.bg },
  margin: [0.5, 0.55, 0.65, 0.55],
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: MX, y: 0.32, w: 10, h: 0.3, fontSize: 11, bold: true, color: T.pink, charSpacing: 3, margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.62, w: W - 2 * MX, h: 0.72, fontSize: 32, bold: true, color: T.text, margin: 0, valign: "top", align: "left" }, text: "" } },
    { text: { text: "Adaptive RAG · feature tour", options: { x: MX, y: 7.05, w: 5, h: 0.28, fontSize: 10, color: T.muted, margin: 0 } } },
  ],
  slideNumber: { x: W - MX - 0.8, y: 7.05, w: 0.8, h: 0.28, fontSize: 10, color: T.muted, align: "right" },
});

// ------------------------------------------------------------------ assets
const IMG = {};
async function prep(name, src, extract, maxW = 1920) {
  let p = sharp(src);
  if (extract) p = p.extract(extract);
  const out = `${DIR}/img/${name}.jpg`;
  await p.resize({ width: maxW, withoutEnlargement: true }).jpeg({ quality: 86 }).toFile(out);
  const m = await sharp(out).metadata();
  IMG[name] = { path: out, w: m.width, h: m.height };
}
const ICON = {};
async function icon(name, color) {
  const key = `${name}-${color}`;
  if (ICON[key]) return ICON[key];
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(lu[name], { color: "#" + color, size: 256, strokeWidth: 1.75 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return (ICON[key] = "image/png;base64," + buf.toString("base64"));
}

// ------------------------------------------------------------------ helpers
let objN = 0;
const oname = (s) => `${s}-${++objN}`;
const shadow = () => ({ type: "outer", color: "000000", blur: 10, offset: 3, angle: 90, opacity: 0.35 });

/** A screenshot in a rounded frame, fitted inside box (keeps aspect ratio). Returns its rect. */
function framed(s, name, box, opt = {}) {
  const im = IMG[name];
  const ar = im.w / im.h;
  let w = box.w, h = w / ar;
  if (h > box.h) { h = box.h; w = h * ar; }
  const ax = opt.align || "center", ay = opt.valign || "top";
  const x = box.x + (ax === "left" ? 0 : ax === "right" ? box.w - w : (box.w - w) / 2);
  const y = box.y + (ay === "top" ? 0 : ay === "bottom" ? box.h - h : (box.h - h) / 2);
  const pad = 0.05;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad, rectRadius: 0.07,
    fill: { color: T.card }, line: { color: T.line, width: 1 }, shadow: shadow(), objectName: oname("frame") });
  s.addImage({ path: im.path, x, y, w, h, altText: opt.alt || name, objectName: oname("shot") });
  return { x, y, w, h };
}

/** Numbered marker on a screenshot, at fractions (fx, fy) of its rect. */
function marker(s, n, r, fx, fy, color = T.pink) {
  const d = 0.34;
  s.addText(String(n), { shape: pres.shapes.OVAL, x: r.x + fx * r.w - d / 2, y: r.y + fy * r.h - d / 2, w: d, h: d,
    fill: { color }, line: { color: T.bg, width: 1.5 }, color: T.bg, bold: true, fontSize: 12, align: "center", valign: "middle", margin: 0,
    objectName: oname("marker") });
}

/** Approximate wrapped line count for Calibri at a given size in a box of width w inches. */
function lines(text, w, size) {
  const perLine = Math.max(8, Math.floor(w / (size * 0.0072)));
  return text.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}

/** Numbered list: badge + bold title + muted description. Returns the bottom y. */
function callouts(s, items, x, y, w, opt = {}) {
  const ts = opt.titleSize || 14, ds = opt.descSize || 12, gap = opt.gap ?? 0.16;
  let cy = y;
  items.forEach((it, i) => {
    const color = it.color || T.pink;
    const tw = w - 0.46;
    const h = 0.05 + lines(it.t, tw, ts) * ts * 0.0175 + (it.d ? lines(it.d, tw, ds) * ds * 0.0172 + 0.04 : 0);
    if (opt.numbers !== false) {
      s.addText(String(it.n ?? i + 1), { shape: pres.shapes.OVAL, x, y: cy + 0.01, w: 0.3, h: 0.3, fill: { color }, line: { color, width: 0 },
        color: T.bg, bold: true, fontSize: 11, align: "center", valign: "middle", margin: 0, objectName: oname("badge") });
    }
    const runs = [{ text: it.t, options: { bold: true, color: T.text, fontSize: ts, breakLine: !!it.d } }];
    if (it.d) runs.push({ text: it.d, options: { color: T.muted, fontSize: ds } });
    s.addText(runs, { x: x + (opt.numbers === false ? 0 : 0.46), y: cy, w: opt.numbers === false ? w : tw, h, margin: 0, valign: "top",
      paraSpaceAfter: 2, isTextBox: true, objectName: oname("callout") });
    cy += h + gap;
  });
  return cy;
}

/** A card: rounded rect + optional icon circle + title + body. */
async function card(s, x, y, w, h, o) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.line, width: 1 }, objectName: oname("card") });
  let ty = y + 0.2;
  if (o.icon) {
    const d = 0.56;
    s.addShape(pres.shapes.OVAL, { x: x + 0.2, y: y + 0.2, w: d, h: d, fill: { color: T.bg }, line: { color: o.color || T.pink, width: 1.25 }, objectName: oname("iconbg") });
    s.addImage({ data: await icon(o.icon, o.iconHex || HEX.rhodamine), x: x + 0.2 + 0.14, y: y + 0.2 + 0.14, w: d - 0.28, h: d - 0.28, objectName: oname("icon") });
    ty = y + 0.9;
  }
  if (o.kicker) {
    s.addText(o.kicker, { x: x + 0.2, y: ty, w: w - 0.4, h: 0.26, fontSize: 10, bold: true, color: o.color || T.pink, charSpacing: 2, margin: 0, isTextBox: true, objectName: oname("cardkicker") });
    ty += 0.3;
  }
  s.addText(o.title, { x: x + 0.2, y: ty, w: w - 0.4, h: o.titleH || 0.36, fontSize: o.titleSize || 16, bold: true, color: T.text, margin: 0, valign: "top", isTextBox: true, objectName: oname("cardtitle") });
  if (o.body) s.addText(o.body, { x: x + 0.2, y: ty + (o.titleH || 0.36) + 0.06, w: w - 0.4, h: y + h - (ty + (o.titleH || 0.36) + 0.06) - 0.15, fontSize: o.bodySize || 12, color: T.muted, margin: 0, valign: "top", isTextBox: true, objectName: oname("cardbody") });
}

function caption(s, text, x, y, w, opt = {}) {
  s.addText(text, { x, y, w, h: opt.h || 0.3, fontSize: opt.size || 11, color: opt.color || T.muted, italic: !!opt.italic, bold: !!opt.bold, align: opt.align || "left", margin: 0, valign: "top", isTextBox: true, objectName: oname("caption") });
}

function arrow(s, x1, y1, x2, y2, color = T.line) {
  s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 0.001, h: Math.abs(y2 - y1) || 0.001,
    flipH: x2 < x1, flipV: y2 < y1, line: { color, width: 1.5, endArrowType: "triangle" }, objectName: oname("arrow") });
}

function pill(s, text, x, y, w, color) {
  s.addText(text, { shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.14, x, y, w, h: 0.3, fill: { color: T.bg }, line: { color, width: 1 },
    color: T.text, fontSize: 11, align: "center", valign: "middle", margin: 0, objectName: oname("pill") });
}

let section = "";
function slide(sectionTitle, kicker, title, notes) {
  if (sectionTitle !== section) { pres.addSection({ title: sectionTitle }); section = sectionTitle; }
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle });
  s.addText(kicker, { placeholder: "kicker" });
  s.addText(title, { placeholder: "title" });
  if (notes) s.addNotes(notes);
  return s;
}

// ------------------------------------------------------------------ build
(async () => {
  fs.mkdirSync(`${DIR}/img`, { recursive: true });
  const R = (n) => `${SHOTS}/${n}.jpg`;
  await prep("hero", R("L01-hero-before"));
  await prep("problem", R("L03-problem"), { left: 1180, top: 470, width: 980, height: 600 });
  await prep("sorter", R("L06-sorter-done"));
  await prep("sorterMid", R("L05-sorter-mid"));
  await prep("correct", R("L07-correct"));
  await prep("rankLearned", R("L09-rank"), { left: 1105, top: 300, width: 1035, height: 900 });
  await prep("rankSim", R("L10-rank-similarity-only"), { left: 1105, top: 300, width: 1035, height: 900 });
  await prep("rankPing", R("L08-rank-ping"));
  await prep("loop", R("L11-loop"), { left: 1000, top: 380, width: 1300, height: 810 });
  await prep("arch", R("L13-architecture-hover"), { left: 240, top: 190, width: 1920, height: 1000 });
  await prep("consoleEmpty", R("C01-console-empty"));
  await prep("askAnswer", R("C05-ask-answer"));
  await prep("pill", R("C06-question-pill"));
  await prep("classifier", R("C09-classifier-strip"));
  await prep("memUpdate", R("C08-correct-memory-update"));
  await prep("fat", R("C12-fat-answer"));
  await prep("fatCrop", R("C12-fat-answer"), { left: 430, top: 520, width: 1050, height: 695 });
  await prep("retrieved", R("C13-inspector-retrieved"));
  await prep("inspMap", R("C14-inspector-map"));
  await prep("citeHover", R("C15-citation-hover"));
  await prep("tooltip", R("C16-scorebar-tooltip"));
  await prep("weights", R("C17-inspector-weights"));
  await prep("chips", R("C02-script-chips"));
  await prep("streaming", R("C11-fat-streaming"));
  const I = `${DIR}/img`;
  await prep("memTop", `${I}/mem-top.jpg`);
  await prep("memTerrain", `${I}/mem-terrain.jpg`);
  await prep("memKpis", `${I}/mem-kpis.jpg`, { left: 590, top: 0, width: 886, height: 121 });
  await prep("memTimeline", `${I}/mem-timeline.jpg`, { left: 0, top: 0, width: 1000, height: 74 });
  await prep("memActivity", `${I}/mem-activity.jpg`, { left: 0, top: 0, width: 380, height: 533 });
  await prep("memBank", `${I}/mem-bank.jpg`);
  await prep("memFacts", `${SP}/shots/probe/memory.png`, { left: 1136, top: 1044, width: 440, height: 332 });
  await prep("retCurve", `${SP}/e2e/retrieval.png`, { left: 95, top: 50, width: 960, height: 300 });
  await prep("retReliab", `${I}/ret-reliab.jpg`);
  await prep("retClassifier", `${I}/ret-classifier.jpg`);
  await prep("conEligible", `${SP}/e2e/console.png`, { left: 255, top: 62, width: 695, height: 708 });
  await prep("apiDocs", `${I}/api-docs.jpg`);
  await prep("ctaTerrain", `${I}/cta-terrain.jpg`);
  // same-size tiles for the tour slide
  const tile = async (name, src, position, extract) => {
    let p = sharp(src); if (extract) p = p.extract(extract);
    const out = `${DIR}/img/${name}.jpg`;
    await p.resize({ width: 960, height: 640, fit: "cover", position }).jpeg({ quality: 86 }).toFile(out);
    IMG[name] = { path: out, w: 960, h: 640 };
  };
  await tile("tHero", R("L01-hero-before"), "left");
  await tile("tConsole", R("C12-fat-answer"), "centre");
  await tile("tMemory", `${I}/mem-terrain.jpg`, "centre");
  await tile("tLab", `${I}/ret-classifier.jpg`, "right");

  // ======================================================== 1. Title
  pres.addSection({ title: "Introduction" }); section = "Introduction";
  {
    const s = pres.addSlide({ masterName: "TITLE", sectionTitle: "Introduction" });
    s.addText("AI COURSE PROJECT", { placeholder: "kicker" });
    s.addText("Adaptive RAG", { placeholder: "title" });
    s.addText([
      { text: "Correct it once. It remembers.", options: { bold: true, color: T.pink, fontSize: 24, breakLine: true } },
      { text: " ", options: { fontSize: 10, breakLine: true } },
      { text: "A study assistant that learns from what you tell it — corrections, preferences, short-lived facts — and re-ranks what it retrieves, without retraining the language model.", options: { fontSize: 18, color: T.muted, breakLine: true } },
      { text: " ", options: { fontSize: 10, breakLine: true } },
      { text: "A tour of every feature of the website, with screenshots", options: { fontSize: 14, color: T.text } },
    ], { placeholder: "body" });
    framed(s, "hero", { x: 7.05, y: 1.45, w: 5.75, h: 4.6 }, { valign: "middle", alt: "The landing page hero: Correct it once. It remembers." });
    s.addNotes("Introduce the project in one sentence: Adaptive RAG is a study assistant that answers from university documents and from what the student tells it. The headline says the whole idea — if you correct it once, it remembers, and the old fact is retired instead of quoted again. The key point for the rest of the talk: the language model itself is never retrained. Everything that learns sits around it. In this presentation I walk through every page of the website and show each feature working.");
  }

  // ======================================================== 2. Problem
  {
    const s = slide("Introduction", "THE PROBLEM", "Ordinary RAG answers from a frozen page",
      "Retrieval-augmented generation looks up passages in your documents and hands them to a language model. That works until a rule changes. In the screenshot the student tells a plain RAG system that the department raised attendance to 80 percent — and the next answer still quotes the 75 percent in the PDF, because nothing in the pipeline was listening. Three gaps: corrections are lost, every source is trusted the same forever, and ranking is by similarity only.");
    const r = framed(s, "problem", { x: MX, y: TOP, w: 7.7, h: 5.0 }, { alt: "Landing page: the usual pipeline and a stale answer" });
    caption(s, "From the landing page: the student corrects the rule, and the next answer still quotes 75%.", r.x, r.y + r.h + 0.18, r.w, { size: 12, h: 0.35 });
    const x = 8.75, w = W - MX - x;
    s.addImage({ data: await icon("LuTriangleAlert", HEX.sodium), x, y: TOP + 0.05, w: 0.42, h: 0.42 });
    s.addText("Three gaps in a plain RAG pipeline", { x: x + 0.55, y: TOP + 0.05, w: w - 0.55, h: 0.45, fontSize: 16, bold: true, color: T.text, margin: 0, valign: "middle", isTextBox: true });
    callouts(s, [
      { t: "Corrections go nowhere", d: "Tell it the rule changed to 80% and the next answer still quotes 75% from the PDF." },
      { t: "Every source is trusted equally", d: "A wrong or outdated passage keeps coming back, forever." },
      { t: "Ranked by similarity only", d: "The passage that sounds closest wins, even when it's the wrong source for the question." },
    ], x, TOP + 0.75, w, { gap: 0.35, numbers: false });
  }

  // ======================================================== 3. Idea
  {
    const s = slide("Introduction", "THE IDEA", "Learn around the model, not inside it",
      "Every message goes through five steps. First a classifier decides whether it's worth remembering and how. Then the memory manager adds, replaces, reinforces, expires or discards. Then retrieval finds the closest passages and memories and re-ranks them on four signals. Only then does the language model write the answer, citing numbered sources. Finally, feedback moves the ranking weights and each source's trust. The model in the middle never changes — all the learning is in the database and four weights.");
    const steps = [
      { icon: "LuFilter", t: "Classify", d: "Is this worth remembering — and how?" },
      { icon: "LuBrain", t: "Remember", d: "Add, replace, reinforce, expire or discard" },
      { icon: "LuSearch", t: "Retrieve", d: "Vector search, then re-rank on four signals" },
      { icon: "LuSparkles", t: "Generate", d: "The LLM answers and cites [n]" },
      { icon: "LuThumbsUp", t: "Learn", d: "Feedback moves weights and source trust" },
    ];
    const cw = 2.18, gap = 0.33, y = 1.75, h = 2.75;
    for (let i = 0; i < steps.length; i++) {
      const x = MX + i * (cw + gap);
      await card(s, x, y, cw, h, { icon: steps[i].icon, kicker: `STEP ${i + 1}`, title: steps[i].t, body: steps[i].d, titleSize: 17, bodySize: 13 });
      if (i < steps.length - 1) arrow(s, x + cw + 0.04, y + h / 2, x + cw + gap - 0.04, y + h / 2, T.kelp || T.muted);
    }
    // what learns vs what stays fixed
    const by = 5.0;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: by, w: 5.95, h: 1.4, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.pink, width: 1 } });
    s.addText([
      { text: "LEARNS", options: { bold: true, color: T.pink, fontSize: 11, charSpacing: 3, breakLine: true } },
      { text: "Memories — added, replaced, expired", options: { bullet: true, color: T.text, fontSize: 14, breakLine: true } },
      { text: "How much each source is trusted", options: { bullet: true, color: T.text, fontSize: 14, breakLine: true } },
      { text: "How the four ranking signals are weighed", options: { bullet: true, color: T.text, fontSize: 14 } },
    ], { x: MX + 0.25, y: by + 0.13, w: 5.5, h: 1.2, margin: 0, valign: "top", paraSpaceAfter: 3, isTextBox: true });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX + 6.28, y: by, w: 5.95, h: 1.4, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.blue, width: 1 } });
    s.addText([
      { text: "STAYS FIXED", options: { bold: true, color: T.blue, fontSize: 11, charSpacing: 3, breakLine: true } },
      { text: "The language model — never trained or fine-tuned", options: { bullet: true, color: T.text, fontSize: 14, breakLine: true } },
      { text: "Your original documents", options: { bullet: true, color: T.text, fontSize: 14, breakLine: true } },
      { text: "Everything is visible and can be undone", options: { bullet: true, color: T.text, fontSize: 14 } },
    ], { x: MX + 6.53, y: by + 0.13, w: 5.5, h: 1.2, margin: 0, valign: "top", paraSpaceAfter: 3, isTextBox: true });
  }

  // ======================================================== 4. Tour map
  {
    const s = slide("Introduction", "THE WEBSITE", "Five pages, one system",
      "The website has five pages. The landing page tells the story as you scroll over a live 3-D map. The console is where you chat, and it shows every step of the pipeline as it happens. The memory page shows everything the assistant has learned, as cards and as a 3-D terrain you can rewind. The retrieval lab exposes the ranking formula, the learned weights and the memory classifier's accuracy. The knowledge page shows the documents it answers from and lets you add new ones. Every app page also has the demo clock for time travel, a Ctrl K command palette, toasts announcing each memory change, and a badge showing which model answers.");
    const pages = [
      { img: "tHero", t: "Landing", d: "/  ·  The story in one scroll over a live 3-D terrain" },
      { img: "tConsole", t: "Console", d: "/console  ·  Chat with every pipeline step shown as it happens" },
      { img: "tMemory", t: "Memory", d: "/memory  ·  What it learned: cards, 3-D terrain, timeline" },
      { img: "tLab", t: "Retrieval lab", d: "/retrieval  ·  Ranking formula, learned weights, classifier accuracy" },
    ];
    const cw = 2.26, gap = 0.22, y = 1.75;
    for (let i = 0; i < pages.length; i++) {
      const x = MX + 0.05 + i * (cw + gap);
      const r = framed(s, pages[i].img, { x, y, w: cw, h: 1.6 }, { valign: "middle", alt: pages[i].t });
      caption(s, pages[i].t, x, y + 1.8, cw, { size: 14, bold: true, color: T.text });
      caption(s, pages[i].d, x, y + 2.15, cw, { size: 12, h: 0.7 });
    }
    // knowledge page: no screenshot, an icon card instead
    const kx = MX + 0.05 + 4 * (cw + gap);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: kx - 0.05, y: y - 0.05, w: cw + 0.1, h: cw / 1.5 + 0.1, rectRadius: 0.07, fill: { color: T.card }, line: { color: T.line, width: 1 } });
    s.addImage({ data: await icon("LuFileText", HEX.glacier), x: kx + cw / 2 - 0.35, y: y + cw / 3 - 0.35, w: 0.7, h: 0.7 });
    caption(s, "Knowledge", kx, y + 1.8, cw, { size: 14, bold: true, color: T.text });
    caption(s, "/knowledge  ·  Documents, passages, and adding new files", kx, y + 2.15, cw, { size: 12, h: 0.7 });
    // shell strip
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: 4.85, w: W - 2 * MX, h: 1.6, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.line, width: 1 } });
    caption(s, "ON EVERY APP PAGE", MX + 0.3, 5.05, 4, { size: 11, bold: true, color: T.pink });
    const shell = [
      { icon: "LuClock", t: "Demo clock", d: "+1 h / +1 d / +1 w time travel" },
      { icon: "LuSearch", t: "Command palette", d: "Ctrl K — go anywhere, search memories" },
      { icon: "LuZap", t: "Toasts", d: "Every memory change is announced" },
      { icon: "LuServer", t: "Live API badge", d: "Shows which model answers" },
    ];
    for (let i = 0; i < shell.length; i++) {
      const x = MX + 0.3 + i * 2.95;
      s.addImage({ data: await icon(shell[i].icon, HEX.sodium), x, y: 5.52, w: 0.4, h: 0.4 });
      s.addText([{ text: shell[i].t, options: { bold: true, color: T.text, fontSize: 14, breakLine: true } }, { text: shell[i].d, options: { color: T.muted, fontSize: 12 } }],
        { x: x + 0.55, y: 5.45, w: 2.2, h: 0.85, margin: 0, valign: "top", isTextBox: true });
    }
  }

  // ======================================================== LANDING
  {
    const s = slide("Landing page", "LANDING PAGE", "The story in one scroll",
      "The landing page explains the project as one long scroll. Point 1 is the headline. Point 2 is a small live demo that plays by itself: the student asks about the attendance requirement, gets 75 percent, corrects it to 80, and the card updates. Point 3 is the 3-D knowledge terrain behind the page — the same map the app uses. As each section reaches the middle of the screen, the camera moves and the map changes to match what the text is describing.");
    const r = framed(s, "hero", { x: MX, y: TOP, w: 8.2, h: 5.3 }, { alt: "Landing hero" });
    marker(s, 1, r, 0.07, 0.24); marker(s, 2, r, 0.6, 0.24); marker(s, 3, r, 0.42, 0.86);
    const x = 9.2, w = W - MX - x;
    const end = callouts(s, [
      { t: "Headline + call to action", d: "Opens the console or scrolls to how it learns." },
      { t: "Live correction demo", d: "Auto-plays: asks, gets 75%, corrects to 80% — the card updates." },
      { t: "3-D knowledge terrain", d: "Fixed behind the page; each section moves the camera and reshapes the map." },
    ], x, TOP, w, { gap: 0.22 });
    caption(s, "EIGHT SECTIONS", x, end + 0.1, w, { size: 11, bold: true, color: T.pink });
    s.addText("Hero · The problem · What it keeps · Corrections · Ranking · The learning loop · Architecture · Try it", { x, y: end + 0.42, w, h: 0.9, fontSize: 12, color: T.muted, margin: 0, valign: "top", isTextBox: true });
  }
  {
    const s = slide("Landing page", "LANDING PAGE · WHAT IT KEEPS", "It decides what's worth remembering",
      "This section is scroll-driven: each scroll step classifies one example sentence and the chip flies into its lane. 'My name is Harsh' and 'I prefer concise answers' are persistent, a changed deadline is important, 'your previous answer was wrong' is a correction, 'I have an exam tomorrow' is temporary, and 'What's 2+2' is irrelevant — so it's not stored. These are the same five classes the real classifier uses in the console.");
    framed(s, "sorter", { x: MX, y: TOP, w: 8.2, h: 5.3 }, { alt: "All six sentences sorted into five classes" });
    const x = 9.2, w = W - MX - x;
    const classes = [
      { t: "Persistent", d: "About you — name, preferences", color: T.pink },
      { t: "Important", d: "New knowledge — a rule, a deadline", color: T.amber },
      { t: "Correction", d: "Replaces something it believed", color: T.blue },
      { t: "Temporary", d: "True for a while — kept until it expires", color: T.green },
      { t: "Irrelevant", d: "Questions, small talk — not stored", color: T.muted },
    ];
    caption(s, "FIVE CLASSES", x, TOP, w, { size: 11, bold: true, color: T.pink });
    let cy = TOP + 0.4;
    for (const c of classes) {
      s.addShape(pres.shapes.OVAL, { x, y: cy + 0.06, w: 0.2, h: 0.2, fill: { color: c.color }, line: { color: c.color, width: 0 } });
      s.addText([{ text: c.t, options: { bold: true, color: T.text, fontSize: 14, breakLine: true } }, { text: c.d, options: { color: T.muted, fontSize: 12 } }],
        { x: x + 0.35, y: cy, w: w - 0.35, h: 0.7, margin: 0, valign: "top", isTextBox: true });
      cy += 0.82;
    }
    caption(s, "Scroll-driven: each scroll step sorts the next sentence.", x, cy + 0.05, w, { size: 11, italic: true, h: 0.5 });
  }
  {
    const s = slide("Landing page", "LANDING PAGE · CORRECTIONS", "Corrections replace — they don't pile up",
      "Storing both 75 and 80 percent would leave the assistant guessing. So when new information collides with something it believes, it checks the source, marks the old value as outdated and keeps it as history, and makes the new value current. The 'Stored as' record on the right shows exactly what gets saved: the knowledge, its source, a confidence, its status, the previous value and a timestamp. Behind the cards, the terrain zooms in on the attendance cluster.");
    const r = framed(s, "correct", { x: MX, y: TOP, w: 8.2, h: 5.3 }, { alt: "What it believed vs what you said, and the stored record" });
    marker(s, 1, r, 0.684, 0.245); marker(s, 2, r, 0.49, 0.228); marker(s, 3, r, 0.479, 0.508);
    const x = 9.2, w = W - MX - x;
    callouts(s, [
      { t: "Conflict detected", d: "Same topic (minimum attendance), different value: 75% vs 80%." },
      { t: "Old value kept as history", d: "75% is marked outdated, not deleted — you see what changed." },
      { t: "New value becomes current", d: "Stored with its source (you), a confidence and the previous value." },
    ], x, TOP + 0.3, w, { gap: 0.55 });
  }
  {
    const s = slide("Landing page", "LANDING PAGE · RANKING", "Ranked by more than similarity",
      "Each candidate passage or memory gets four signals: similarity, recency, confidence and importance. The score is a weighted sum. On the left, with the learned weights, the official regulation wins. On the right I pressed 'Similarity only' — now the source that merely sounds closest wins, even though it's the wrong one for this question. The sliders let you try any weights live.");
    const half = (W - 2 * MX - 0.4) / 2;
    const r1 = framed(s, "rankLearned", { x: MX, y: TOP, w: half, h: 4.6 }, { alt: "Learned weights ranking" });
    const r2 = framed(s, "rankSim", { x: MX + half + 0.4, y: TOP, w: half, h: 4.6 }, { alt: "Similarity-only ranking" });
    pill(s, "Learned weights", r1.x, r1.y + r1.h + 0.2, 1.8, T.green);
    caption(s, "Right regulation wins: confidence and importance beat raw similarity.", r1.x + 1.95, r1.y + r1.h + 0.2, r1.w - 1.95, { size: 12, h: 0.45 });
    pill(s, "Similarity only", r2.x, r2.y + r2.h + 0.2, 1.8, T.amber);
    caption(s, "Closest-sounding text wins, even from the wrong source.", r2.x + 1.95, r2.y + r2.h + 0.2, r2.w - 1.95, { size: 12, h: 0.45 });
  }
  {
    const s = slide("Landing page", "LANDING PAGE · LEARNING LOOP + ARCHITECTURE", "The model stays the same; everything around it learns",
      "Left: the learning loop. A question goes to retrieval, the model answers, you give feedback, retrieval is evaluated, and memory and weights are updated — the language model in the centre is unchanged. Right: the interactive architecture diagram. Hovering a block, here the adaptive retriever, highlights its connections: it reads the vector database, long-term memory and documents, and passes context to the LLM. The dashed path shows knowledge evolving through the memory manager and feedback.");
    const H = 3.4;
    const r1 = framed(s, "loop", { x: MX, y: TOP, w: 5.6, h: H }, { align: "left", alt: "The learning loop" });
    const r2 = framed(s, "arch", { x: r1.x + r1.w + 0.4, y: TOP, w: W - MX - (r1.x + r1.w + 0.4), h: H }, { align: "left", alt: "Architecture diagram" });
    caption(s, "THE LEARNING LOOP", r1.x, r1.y + r1.h + 0.25, r1.w, { size: 11, bold: true, color: T.pink });
    caption(s, "Question → retrieve → answer → your feedback → evaluate retrieval → update memory & weights. The language model in the centre is unchanged.", r1.x, r1.y + r1.h + 0.58, r1.w, { size: 13, h: 0.9 });
    caption(s, "THE ARCHITECTURE, INTERACTIVE", r2.x, r2.y + r2.h + 0.25, r2.w, { size: 11, bold: true, color: T.pink });
    caption(s, "Hover any block: the adaptive retriever reads the vector DB, long-term memory and documents, then hands context to the LLM.", r2.x, r2.y + r2.h + 0.58, r2.w, { size: 13, h: 0.9 });
  }

  // ======================================================== CONSOLE
  {
    const s = slide("Console", "CONSOLE", "Chat with the whole pipeline on show",
      "This is the console, the main page. On the left is the conversation: every message shows how it was classified and what was written to memory, and every answer cites its sources. On the right is the inspector for the selected answer: a memory map showing where the question landed, and the ranked list of sources it used with their score bars. At the bottom is the guided demo script — nine chips that run the story from the project brief. At the top are the demo clock, which can jump forward in time, and the badge showing the live backend. On the far left, the navigation rail switches between Console, Memory, Retrieval and Knowledge.");
    const r = framed(s, "fat", { x: MX, y: TOP, w: 8.55, h: 5.35 }, { alt: "Console after the third demo step" });
    marker(s, 1, r, 0.164, 0.57); marker(s, 2, r, 0.68, 0.165); marker(s, 3, r, 0.68, 0.468); marker(s, 4, r, 0.023, 0.866); marker(s, 5, r, 0.536, 0.029); marker(s, 6, r, 0.024, 0.37);
    const x = 9.5, w = W - MX - x;
    callouts(s, [
      { t: "Conversation", d: "Classifier verdict, memory writes, cited answer." },
      { t: "Memory map", d: "Where the question landed; rings mark sources used." },
      { t: "Retrieved for this answer", d: "Top 5 sources with score bars (S, R, C, I)." },
      { t: "Demo script", d: "Nine chips run the guided story." },
      { t: "Demo clock + Live API", d: "Time travel; which model answers." },
      { t: "Navigation rail", d: "Console · Memory · Retrieval · Knowledge." },
    ], x, TOP, w, { gap: 0.12, titleSize: 14, descSize: 12 });
  }
  {
    const s = slide("Console", "CONSOLE · DEMO STEP 1", "Ask: it answers from the regulations",
      "Step one: 'What is the minimum attendance requirement?' The classifier recognises a question — the small pill says 'Question · not stored', and opening it shows the probabilities: irrelevant 0.74, because asking isn't telling. The answer comes from Academic Regulations section 3.1: 75 percent, with citations. The inspector on the right shows the five sources it ranked, and the map shows where the question landed.");
    const r = framed(s, "askAnswer", { x: MX, y: TOP, w: 7.7, h: 4.85 }, { alt: "Answer to the first question with citations" });
    const x = 8.55, w = W - MX - x;
    marker(s, 2, r, 0.171, 0.2); marker(s, 3, r, 0.69, 0.463);
    const rp = framed(s, "pill", { x, y: TOP, w, h: 1.6 }, { alt: "Question pill expanded: Irrelevant 0.74" });
    marker(s, 1, rp, 0.075, 0.2);
    callouts(s, [
      { t: "A question is not stored", d: "Asking isn't telling — the classifier marks it 'Question · not stored'." },
      { t: "Answer: 75%, with citations", d: "From Academic Regulations 2024 §3.1; every claim carries a [n] chip." },
      { t: "Inspector explains the ranking", d: "Searched 28 passages + memories → similar enough → top 5 re-ranked." },
    ], x, TOP + 1.95, w, { gap: 0.2 });
  }
  {
    const s = slide("Console", "CONSOLE · DEMO STEP 2", "Correct it: the memory classifier at work",
      "Step two: 'Our department changed it to 80 percent last semester.' The classifier says correction with 0.99. It highlights the cue word 'changed', the value '80 percent' and the time 'last semester'. It resolves 'it' to minimum attendance from the previous question, finds the conflict with the 75 percent in the regulations, and decides to replace: 80 percent becomes current and 75 percent is kept as history, marked outdated. The memory-write card at the bottom shows what was stored.");
    const r = framed(s, "classifier", { x: MX, y: TOP, w: 7.75, h: 5.3 }, { alt: "Memory classifier strip for the correction" });
    marker(s, 1, r, 0.045, 0.27); marker(s, 2, r, 0.68, 0.04); marker(s, 3, r, 0.035, 0.635); marker(s, 4, r, 0.035, 0.885);
    const x = 8.7, w = W - MX - x;
    callouts(s, [
      { t: "Class probabilities", d: "Correction 0.99 — from the trained classifier (TF-IDF + logistic regression)." },
      { t: "Highlighted evidence", d: "Cue 'changed', value '80%', time 'last semester'." },
      { t: "Uses the conversation", d: "Resolves 'it' → minimum attendance; finds the conflict with 75% in §3.1." },
      { t: "Decision: replace", d: "80% becomes current; 75% is kept as history, marked outdated." },
    ], x, TOP, w, { gap: 0.18 });
  }
  {
    const s = slide("Console", "CONSOLE · DEMO STEP 3", "The next answer uses the correction",
      "Step three: 'When can I write my FAT?' The answer now says 80 percent — your department's rule, not the university's 75 — and cites both. On the right you can see why: the inspector ranked the 80 percent correction memory third, and the regulation section 3.1 passage carries the note 'Overridden for minimum attendance → 80% (your correction)'. The query was also expanded with context terms like 'minimum attendance' and 'my current attendance'.");
    const r1 = framed(s, "fatCrop", { x: MX, y: TOP, w: 5.55, h: 5.3 }, { align: "left", valign: "middle", alt: "Correction acknowledged and the FAT answer using 80%" });
    marker(s, 1, r1, 0.0, 0.6);
    const r2 = framed(s, "retrieved", { x: 6.45, y: TOP, w: 4.1, h: 5.3 }, { align: "left", alt: "Retrieved for this answer, with the override note" });
    marker(s, 2, r2, -0.035, 0.535); marker(s, 3, r2, -0.035, 0.745); marker(s, 4, r2, -0.035, 0.17);
    const cx = r2.x + r2.w + 0.3;
    callouts(s, [
      { n: 1, t: "Answer says 80%", d: "Cites your correction and the old 75% rule." },
      { n: 2, t: "Correction ranked 3rd", d: "Your memory scores 0.70, next to the regulations." },
      { n: 3, t: "§3.1 kept, overridden", d: "“Overridden for minimum attendance → 80%”." },
      { n: 4, t: "Query expanded", d: "Context terms added from the conversation." },
    ], cx, TOP, W - MX - cx, { gap: 0.25, titleSize: 13, descSize: 12 });
  }
  {
    const s = slide("Console", "CONSOLE · CITATIONS", "Every claim is cited — and traceable",
      "Each answer cites numbered sources, and the chips are live. Hovering chip 1 in the FAT answer lights up the same source everywhere: the chip itself, the matching row in 'Retrieved for this answer' — here the 80 percent correction memory — and its label on the memory map. Clicking a chip opens the source drawer with the full passage or memory, its reliability, and any override. So the professor can trace any claim back to where it came from.");
    const r = framed(s, "citeHover", { x: MX, y: TOP, w: 8.55, h: 5.35 }, { alt: "Hovering a citation chip highlights the source" });
    marker(s, 1, r, 0.167, 0.625); marker(s, 2, r, 0.685, 0.79); marker(s, 3, r, 0.919, 0.23);
    const x = 9.5, w = W - MX - x;
    callouts(s, [
      { t: "Hover a citation chip", d: "Chip [1] in the FAT answer." },
      { t: "The source row lights up", d: "Minimum attendance = 80% (your correction), 0.70" },
      { t: "…and its map label", d: "3 · Min. attendance 80%." },
      { t: "Click to open the source", d: "A drawer shows the passage or memory, its reliability and any override." },
    ], x, TOP, w, { gap: 0.2 });
  }
  {
    const s = slide("Console", "CONSOLE · INSPECTOR", "Why each source was picked",
      "The inspector shows the reasoning behind each answer. Top left: the memory map — the question's ping lands in the attendance cluster and the five used sources are ringed and numbered. Bottom left: the current ranking weights, the same formula used everywhere. Right: hovering a score bar breaks a source's score into its four parts — similarity, recency, confidence and importance — so you can see exactly why something ranked where it did.");
    const r1 = framed(s, "inspMap", { x: MX, y: TOP, w: 4.95, h: 3.4 }, { align: "left", alt: "Inspector memory map with ranked labels" });
    const r2 = framed(s, "weights", { x: MX, y: r1.y + r1.h + 0.3, w: 4.95, h: 1.8 }, { align: "left", alt: "Ranking weights panel" });
    const r3 = framed(s, "tooltip", { x: 5.85, y: TOP, w: 4.1, h: 5.3 }, { align: "left", alt: "Score bar tooltip" });
    marker(s, 1, r1, 0.0, 0.0); marker(s, 2, r2, 0.0, 0.0); marker(s, 3, r3, 0.0, 0.0);
    const x = r3.x + r3.w + 0.35, w = W - MX - x;
    callouts(s, [
      { t: "Memory map", d: "Ping = where the question landed; numbered rings = sources used." },
      { t: "Ranking weights", d: "The four signal weights S, R, C, I — tunable in the lab." },
      { t: "Retrieved sources", d: "Hover a score bar: how much each signal added." },
    ], x, TOP, w, { gap: 0.25, titleSize: 13, descSize: 12 });
  }
  {
    const s = slide("Console", "CONSOLE · DEMO STEPS 4–8", "Every message gets a different decision",
      "Steps four to eight show the other decisions. 'I prefer concise answers' replaces the old step-by-step preference. 'I have a DBMS exam tomorrow' is temporary — kept until the end of tomorrow, then it expires. 'What's 2 plus 2' is answered directly and nothing is stored. 'My attendance is 78 percent' is stored as a fact about you. Finally, 'Am I eligible for FAT?' combines everything: your 78 percent, your department's 80 percent correction and the debarment rule, to answer 'Not yet'.");
    const rows = [
      ["MESSAGE", "CLASSIFIED AS", "WHAT HAPPENS"],
      ["I prefer concise answers.", "Persistent · preference", "Replaces the step-by-step preference; answers get shorter"],
      ["I have a DBMS exam tomorrow.", "Temporary", "Kept until the end of tomorrow, then expires"],
      ["What's 2+2?", "Question · not stored", "Answered directly — no documents needed"],
      ["My attendance is 78%.", "Persistent · about you", "Stored as a fact about the student (0.85)"],
      ["Am I eligible for FAT?", "Question", "Combines 78% + the 80% correction + debarment → “Not yet”"],
    ];
    const tbl = rows.map((r, i) => r.map((c, j) => ({ text: c, options: {
      bold: i === 0 || j === 0, color: i === 0 ? T.pink : j === 0 ? T.text : T.muted, fontSize: i === 0 ? 11 : 12,
      fill: { color: i === 0 ? T.bg : T.card } } })));
    s.addTable(tbl, { x: MX, y: TOP, w: 7.25, colW: [2.15, 1.75, 3.35], border: { type: "solid", pt: 0.75, color: T.line }, margin: 0.08, valign: "middle", rowH: [0.4, 0.78, 0.78, 0.78, 0.78, 0.78] });
    framed(s, "conEligible", { x: 8.2, y: TOP, w: W - MX - 8.2, h: 5.3 }, { align: "right", alt: "Attendance stored and the eligibility answer" });
    caption(s, "Right: “My attendance is 78%” stored as persistent, then the eligibility answer citing all three sources.", MX, 6.35, 7.25, { size: 12, h: 0.45 });
  }
  {
    const s = slide("Console", "CONSOLE · FEEDBACK", "Feedback teaches the ranking",
      "Under every answer there's 'Was this helpful?'. Helpful nudges the weights towards the signals that ranked the cited sources highly, and raises their trust a little. Not helpful asks what went wrong — wrong source, outdated or incomplete — and which source. In this run I marked the eligibility answer's source as outdated: its reliability dropped from 1.00 to 0.80 — outdated multiplies it by 0.8 — and the four weights moved, shown as small deltas. Each answer accepts feedback once.");
    const steps = [
      { icon: "LuThumbsDown", t: "Not helpful", d: "Under any answer" },
      { icon: "LuListChecks", t: "What went wrong?", d: "Wrong source · Outdated · Incomplete" },
      { icon: "LuTarget", t: "Which source?", d: "Pick it from the ranked list" },
      { icon: "LuRefreshCw", t: "It adapts", d: "Trust drops; weights move" },
    ];
    const cw = 2.85, gap = 0.28, y = TOP, h = 1.95;
    for (let i = 0; i < steps.length; i++) {
      const x = MX + i * (cw + gap);
      await card(s, x, y, cw, h, { icon: steps[i].icon, title: steps[i].t, body: steps[i].d, titleSize: 15, bodySize: 12, titleH: 0.32 });
      if (i < steps.length - 1) arrow(s, x + cw + 0.03, y + h / 2, x + cw + gap - 0.03, y + h / 2, T.muted);
    }
    // result example + formulas
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: 3.8, w: 6.0, h: 2.45, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.line, width: 1 } });
    s.addText([
      { text: "RESULT IN THIS RUN  (marked outdated)", options: { bold: true, color: T.pink, fontSize: 11, charSpacing: 3, breakLine: true } },
      { text: " ", options: { fontSize: 5, breakLine: true } },
      { text: "Lowered trust in “Current attendance is 78%”", options: { bold: true, color: T.text, fontSize: 15, breakLine: true } },
      { text: "reliability 1.00 → 0.80", options: { color: T.muted, fontSize: 14, breakLine: true } },
      { text: " ", options: { fontSize: 8, breakLine: true } },
      { text: "Weights:  S +0.030 · R −0.048 · C +0.010 · I +0.008", options: { color: T.text, fontSize: 13, breakLine: true } },
      { text: " ", options: { fontSize: 8, breakLine: true } },
      { text: "Helpful instead → the cited sources gain trust (+0.03) and the weights lean towards what ranked them first.", options: { color: T.muted, fontSize: 12 } },
    ], { x: MX + 0.25, y: 3.98, w: 5.5, h: 2.15, margin: 0, valign: "top", isTextBox: true });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.85, y: 3.8, w: W - MX - 6.85, h: 2.45, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.amber, width: 1 } });
    s.addText([
      { text: "THE UPDATE RULES  (learning.py)", options: { bold: true, color: T.amber, fontSize: 11, charSpacing: 2, breakLine: true } },
      { text: " ", options: { fontSize: 5, breakLine: true } },
      { text: "Weights (pairwise ranking update)", options: { bold: true, color: T.text, fontSize: 14, breakLine: true } },
      { text: "w ← normalise(w + η·clip(f_preferred − f_rejected))", options: { color: T.text, fontSize: 13, breakLine: true } },
      { text: "η = 0.08 · each step capped at ±0.05 · every weight ≥ 0.02 · sum = 1", options: { color: T.muted, fontSize: 12, breakLine: true } },
      { text: " ", options: { fontSize: 8, breakLine: true } },
      { text: "Source reliability", options: { bold: true, color: T.text, fontSize: 14, breakLine: true } },
      { text: "rejected × 0.85 (floor 0.2) · outdated × 0.8 · helpful + 0.03", options: { color: T.muted, fontSize: 12 } },
    ], { x: 7.1, y: 3.98, w: W - MX - 7.35, h: 2.15, margin: 0, valign: "top", isTextBox: true });
  }

  // ======================================================== MEMORY
  {
    const s = slide("Memory & terrain", "MEMORY PAGE", "Everything it has learned",
      "The memory page is the assistant's long-term memory made visible. One: an 'as of' timeline — drag it to rewind, or press play to watch memory evolve. Two: counters for passages indexed, long-term memories, corrections, conflicts resolved and messages processed, each with a 12-day sparkline. Three: the knowledge terrain, in 3-D relief or as a 2-D map. Four: the activity feed, which lists every memory event — added, corrected, expired.");
    const r = framed(s, "memTop", { x: MX, y: TOP, w: 8.3, h: 5.3 }, { alt: "Memory page overview" });
    marker(s, 1, r, 0.0, 0.15); marker(s, 2, r, 0.0, 0.245); marker(s, 3, r, 0.0, 0.39); marker(s, 4, r, 0.72, 0.39);
    const x = 9.3, w = W - MX - x;
    callouts(s, [
      { t: "“As of” timeline", d: "Drag to rewind; press play to replay how memory evolved." },
      { t: "Counters", d: "Passages 28 · memories 8 · corrections · conflicts resolved · messages." },
      { t: "Knowledge terrain", d: "3-D relief or 2-D map; click a peak to inspect it." },
      { t: "Activity feed", d: "Every memory event: added, corrected, expired." },
    ], x, TOP, w, { gap: 0.25 });
  }
  {
    const s = slide("Memory & terrain", "THE KNOWLEDGE TERRAIN", "A map of everything it knows",
      "This is the knowledge terrain. Every document passage and every memory is a peak. Blue hills are passages from the official documents; pink peaks are facts the assistant learned in conversation. Things with similar meaning sit close together, so all the attendance rules form one cluster. The height of a peak is how strongly it's held — a memory you haven't used in a while slowly sinks. Outdated facts aren't deleted; they show as dashed rings. You can switch to a flat 2-D map, and clicking a peak opens that memory.");
    framed(s, "memTerrain", { x: MX, y: TOP, w: 8.6, h: 5.3 }, { alt: "Knowledge terrain in 3-D relief" });
    const x = 9.55, w = W - MX - x;
    const legend = [
      { t: "Blue hills", d: "Passages from the official documents", c: T.blue },
      { t: "Pink peaks", d: "Facts learned in conversation", c: T.pink },
      { t: "Height", d: "How strongly it's held — decays when unused", icon: "LuMountain" },
      { t: "Distance", d: "Meaning: similar items sit close together", icon: "LuMoveHorizontal" },
      { t: "Dashed ring", d: "An outdated fact, kept as history", dashed: true },
    ];
    let cy = TOP;
    for (const l of legend) {
      if (l.icon) s.addImage({ data: await icon(l.icon, HEX.foam), x: x - 0.02, y: cy + 0.03, w: 0.27, h: 0.27 });
      else if (l.dashed) s.addShape(pres.shapes.OVAL, { x, y: cy + 0.05, w: 0.24, h: 0.24, fill: { type: "none" }, line: { color: T.text, width: 1.25, dashType: "dash" } });
      else s.addShape(pres.shapes.OVAL, { x, y: cy + 0.06, w: 0.22, h: 0.22, fill: { color: l.c }, line: { color: l.c, width: 0 } });
      s.addText([{ text: l.t, options: { bold: true, color: T.text, fontSize: 14, breakLine: true } }, { text: l.d, options: { color: T.muted, fontSize: 12 } }],
        { x: x + 0.38, y: cy, w: w - 0.38, h: 0.75, margin: 0, valign: "top", isTextBox: true });
      cy += 0.86;
    }
    caption(s, "Appears on four pages: landing (full screen), console inspector, memory, knowledge.", x, cy + 0.05, w, { size: 11, italic: true, h: 0.6 });
  }
  {
    const s = slide("Memory & terrain", "THE KNOWLEDGE TERRAIN · HOW IT WORKS", "How the terrain is built",
      "Here's how the terrain is computed. First every passage and memory is turned into a 384-number vector — an embedding of its meaning. Second, classical multidimensional scaling squeezes those vectors onto a flat x-y plane so that similar items stay close; new items are placed next to their nearest neighbours. Third, each item gets a peak height: for memories it's 0.22 plus 0.85 times its current strength; for passages it depends on importance and reliability. Fourth, the graphics card sums Gaussian bumps over a 260 by 150 grid, normalises it, and draws 14 contour levels, coloured from blue for documents to pink for memories. On the right, the console's version shows the question's ping and the five sources it used, ringed and numbered.");
    const steps = [
      { n: "1", icon: "LuBinary", t: "Embed", d: "Each passage and memory becomes a 384-number vector from the MiniLM sentence model." },
      { n: "2", icon: "LuMap", t: "Place", d: "Classical MDS on cosine distance → x, y. New items are placed beside their nearest neighbours." },
      { n: "3", icon: "LuMountain", t: "Height", d: "Memory: 0.22 + 0.85 × strength\nPassage: (0.34 + 0.3·importance) × (0.55 + 0.45·reliability)" },
      { n: "4", icon: "LuLayers", t: "Render on the GPU", d: "Sum of Gaussian peaks on a 260×150 grid, normalised; 14 contour levels; colour blue → pink by memory share." },
    ];
    let y = TOP;
    for (const st of steps) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y, w: 6.9, h: 1.17, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.line, width: 1 } });
      s.addShape(pres.shapes.OVAL, { x: MX + 0.2, y: y + 0.28, w: 0.6, h: 0.6, fill: { color: T.bg }, line: { color: T.pink, width: 1.25 } });
      s.addImage({ data: await icon(st.icon, HEX.rhodamine), x: MX + 0.35, y: y + 0.43, w: 0.3, h: 0.3 });
      s.addText([{ text: `${st.n} · ${st.t}`, options: { bold: true, color: T.text, fontSize: 15, breakLine: true } }, { text: st.d, options: { color: T.muted, fontSize: 12 } }],
        { x: MX + 1.0, y: y + 0.12, w: 5.75, h: 0.95, margin: 0, valign: "top", isTextBox: true });
      y += 1.32;
    }
    const r = framed(s, "inspMap", { x: 7.8, y: TOP, w: W - MX - 7.8, h: 3.6 }, { alt: "Console memory map with ping and ranked rings" });
    callouts(s, [
      { t: "Live signals on the map", d: "Amber ping = where a question lands. Numbered rings = the sources used. Ripples = a memory was added, replaced, flagged or expired.", color: T.amber },
    ], r.x - 0.05, r.y + r.h + 0.3, r.w + 0.05, { gap: 0.1, numbers: false });
  }
  {
    const s = slide("Memory & terrain", "MEMORY · FORGETTING", "Memories fade unless they're used",
      "Each memory has a strength that decays over time like a forgetting curve: importance times confidence times e to the minus time-since-last-use over tau. Tau depends on the class — corrections last longest, 90 days; temporary facts only about a day. Every time a memory is used in an answer, its tau grows by 20 percent, so useful facts last longer — like spaced repetition. Pinned memories don't decay. Temporary memories, like the DBMS exam, also have a hard expiry: in demo step 9, the clock jumps past the exam and the memory expires.");
    const days = Array.from({ length: 13 }, (_, i) => i * 5);
    const series = [
      { name: "Correction (τ = 90 d)", tau: 90 }, { name: "Persistent (τ = 60 d)", tau: 60 },
      { name: "Important (τ = 45 d)", tau: 45 }, { name: "Temporary (τ = 1.2 d)", tau: 1.2 },
    ].map((x) => ({ name: x.name, labels: days.map(String), values: days.map((d) => +Math.exp(-d / x.tau).toFixed(3)) }));
    s.addChart(pres.charts.LINE, series, {
      x: MX, y: TOP, w: 7.4, h: 5.25, chartColors: [HEX.glacier, HEX.rhodamine, HEX.sodium, HEX.vizR], lineSize: 2.5, lineDataSymbol: "none",
      showTitle: true, title: "Strength left after N days without use", titleColor: HEX.foam, titleFontSize: 14, titleFontFace: "+mn-lt",
      catAxisLabelColor: HEX.kelp, valAxisLabelColor: HEX.kelp, catAxisLabelFontSize: 11, valAxisLabelFontSize: 11, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
      valAxisMinVal: 0, valAxisMaxVal: 1, valAxisLabelFormatCode: "0%", valAxisMajorUnit: 0.25,
      valGridLine: { color: HEX.shelf, size: 0.5 }, catGridLine: { style: "none" }, catAxisLineColor: HEX.shelf, valAxisLineShow: false,
      showLegend: true, legendPos: "b", legendColor: HEX.foam, legendFontSize: 11, legendFontFace: "+mn-lt",
      showCatAxisTitle: true, catAxisTitle: "days since last use", catAxisTitleColor: HEX.kelp, catAxisTitleFontSize: 11, catAxisTitleFontFace: "+mn-lt",
      plotArea: { fill: { color: HEX.trench } },
    });
    const x = 8.35, w = W - MX - x;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: TOP, w, h: 1.3, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.amber, width: 1 } });
    s.addText([
      { text: "strength = importance × confidence × e^(−Δt/τ)", options: { bold: true, color: T.text, fontSize: 13, breakLine: true } },
      { text: "τ = base(class) × 1.2^uses", options: { bold: true, color: T.text, fontSize: 13, breakLine: true } },
      { text: "Each use stretches τ by 20% (up to 8 uses).", options: { color: T.muted, fontSize: 12 } },
    ], { x: x + 0.15, y: TOP + 0.12, w: w - 0.3, h: 1.1, margin: 0, valign: "top", isTextBox: true });
    callouts(s, [
      { t: "Corrections last longest", d: "τ = 90 days; persistent 60; important 45." },
      { t: "Temporary facts expire", d: "“DBMS exam tomorrow” is kept until the end of tomorrow." },
      { t: "Time travel to test it", d: "+1 h / +1 d / +1 w or demo step 9 jumps the clock past the exam." },
      { t: "Pin to keep forever", d: "Pinned memories don't decay." },
    ], x, TOP + 1.6, w, { gap: 0.2, titleSize: 13, descSize: 12 });
  }
  {
    const s = slide("Memory & terrain", "MEMORY · BANK + VERSION CHAINS", "Memory bank and facts that changed",
      "Below the terrain is the memory bank: one card per memory, with its type — about you, important, correction, preference — its source, its current strength bar and how many times it was used. Filters narrow by type and status, including 'Replaced and expired' to see history. On the right, 'Facts that changed' shows each version chain: the library hours went from 8am to 8pm in the document to 'closes at 10pm' from the student; the answer style went from bullet points to step-by-step. Clicking any card opens its drawer with the full record and its forgetting curve.");
    const r1 = framed(s, "memBank", { x: MX, y: TOP, w: 7.6, h: 4.95 }, { align: "left", alt: "Memory bank cards" });
    const x = 8.55, w = W - MX - x;
    const r2 = framed(s, "memFacts", { x, y: TOP, w, h: 3.1 }, { align: "left", alt: "Facts that changed" });
    marker(s, 1, r1, 0.0, 0.0); marker(s, 2, r2, 0.0, 0.0);
    callouts(s, [
      { t: "Cards with strength bars", d: "Filter by type and status (Current · Replaced & expired · Everything)." },
      { t: "Version chains", d: "Old value struck through → current value, with source, date and confidence." },
    ], x, r2.y + r2.h + 0.3, w, { gap: 0.15, titleSize: 13, descSize: 12 });
  }
  {
    const s = slide("Memory & terrain", "MEMORY · TIMELINE + ACTIVITY", "Rewind memory to any moment",
      "The timeline at the top of the memory page is a slider over the whole history. Each tick is an event. Drag it back and the whole page — terrain, cards, counters — is recomputed as it was at that moment, so you can show the professor the memory before and after a correction. The play button replays the history as an animation. The counters each have a 12-day sparkline, and the activity feed on the right lists every event: temporary memory kept and expired, new knowledge added, a previous fact corrected, a preference updated.");
    const lw = 8.1;
    const r1 = framed(s, "memTimeline", { x: MX, y: TOP + 0.05, w: lw, h: 0.7 }, { align: "left", alt: "As-of timeline" });
    marker(s, 1, r1, 0.0, 0.0);
    caption(s, "“As of” timeline — every tick is a memory event; drag to rewind, ▷ to replay", MX, r1.y + r1.h + 0.15, lw, { size: 13, color: T.text });
    const r2 = framed(s, "memKpis", { x: MX, y: r1.y + r1.h + 0.8, w: lw, h: 1.2 }, { align: "left", alt: "Counters" });
    marker(s, 2, r2, 0.0, 0.0);
    caption(s, "Counters with 12-day sparklines and day-over-day change", MX, r2.y + r2.h + 0.15, lw, { size: 13, color: T.text });
    const ax = 9.0;
    const r3 = framed(s, "memActivity", { x: ax, y: TOP, w: W - MX - ax, h: 5.3 }, { align: "right", alt: "Activity feed" });
    marker(s, 3, r3, 0.0, 0.0);
    callouts(s, [
      { n: 3, t: "Activity feed", d: "Every memory event, newest first: kept, expired, added, corrected, updated." },
      { t: "Rewinding recomputes everything", d: "Terrain heights, card status and counters are recalculated for that moment.", numbers: false },
      { t: "Replay", d: "Press ▷ to watch memory evolve from the first day to now." },
    ].slice(0, 1), MX, r2.y + r2.h + 0.65, lw, { gap: 0.15 });
    s.addText([
      { text: "Rewinding recomputes everything. ", options: { bold: true, color: T.text } },
      { text: "Terrain heights, card status and counters are recalculated for that moment. ", options: { color: T.muted } },
      { text: "Replay: ", options: { bold: true, color: T.text } },
      { text: "press ▷ to watch memory evolve from the first day to now.", options: { color: T.muted } },
    ], { x: MX, y: r2.y + r2.h + 1.45, w: lw, h: 0.9, fontSize: 13, margin: 0, valign: "top", isTextBox: true });
  }

  // ======================================================== RETRIEVAL LAB
  {
    const s = slide("Retrieval lab", "RETRIEVAL LAB", "The ranking formula, four signals",
      "The retrieval lab exposes the ranking. Retrieval has two stages: a vector search finds the 12 nearest passages and memories, then they're re-scored with this formula and the top 5 go to the model. Similarity is how closely the text matches the question. Recency decays with age — 30 days for memories, a year for documents. Confidence is how reliable the source has proven, which is where feedback comes in. Importance comes from the memory class or the document section. At the start of the demo the weights are 0.45, 0.15, 0.25 and 0.15 — already learned from earlier feedback — and every new piece of feedback moves them.");
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: TOP, w: W - 2 * MX, h: 1.0, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.line, width: 1 } });
    s.addText([
      { text: "score  =  ", options: { color: T.muted } },
      { text: "w₁·S", options: { color: T.amber, bold: true } }, { text: "  +  ", options: { color: T.muted } },
      { text: "w₂·R", options: { color: T.green, bold: true } }, { text: "  +  ", options: { color: T.muted } },
      { text: "w₃·C", options: { color: T.cblue, bold: true } }, { text: "  +  ", options: { color: T.muted } },
      { text: "w₄·I", options: { color: T.pink, bold: true } },
    ], { x: MX, y: TOP, w: W - 2 * MX, h: 1.0, fontSize: 30, align: "center", valign: "middle", margin: 0, isTextBox: true });
    const sig = [
      { k: "S", t: "Similarity", d: "Calibrated cosine similarity between the question and the item's embedding.", w: "0.45", c: T.amber, hex: HEX.vizS, icon: "LuSearch" },
      { k: "R", t: "Recency", d: "e^(−age/τ): τ = 30 days for memories, 365 for documents.", w: "0.15", c: T.green, hex: HEX.vizR, icon: "LuClock" },
      { k: "C", t: "Confidence", d: "Confidence × reliability — the part feedback changes.", w: "0.25", c: T.cblue, hex: HEX.vizC, icon: "LuGauge" },
      { k: "I", t: "Importance", d: "From the memory class or the document section.", w: "0.15", c: T.pink, hex: HEX.vizI, icon: "LuTarget" },
    ];
    const cw = 2.85, gap = 0.28, y = 2.8, h = 1.95;
    for (let i = 0; i < sig.length; i++) {
      const x = MX + i * (cw + gap);
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h, rectRadius: 0.1, fill: { color: T.card }, line: { color: sig[i].c, width: 1.25 } });
      s.addText(sig[i].k, { x: x + 0.2, y: y + 0.15, w: 0.8, h: 0.75, fontSize: 40, bold: true, color: sig[i].c, margin: 0, valign: "top", isTextBox: true });
      s.addText(`weight now ${sig[i].w}`, { x: x + 1.0, y: y + 0.3, w: cw - 1.2, h: 0.4, fontSize: 11, color: T.muted, align: "right", margin: 0, isTextBox: true });
      s.addText([{ text: sig[i].t, options: { bold: true, color: T.text, fontSize: 16, breakLine: true } }, { text: sig[i].d, options: { color: T.muted, fontSize: 12 } }],
        { x: x + 0.2, y: y + 0.95, w: cw - 0.4, h: h - 1.1, margin: 0, valign: "top", isTextBox: true });
    }
    s.addImage({ data: await icon("LuSlidersHorizontal", HEX.sodium), x: MX, y: 5.15, w: 0.38, h: 0.38 });
    s.addText([
      { text: "Two-stage retrieval: ", options: { bold: true, color: T.text } },
      { text: "vector search keeps the 12 nearest items (similarity ≥ 0.2), the formula re-ranks them, the top 5 go to the model. In the lab, “Try your own” lets you drag the weights (they always sum to 1) and watch rows move ▲▼ before applying them to the assistant.", options: { color: T.muted } },
    ], { x: MX + 0.55, y: 5.07, w: W - 2 * MX - 0.55, h: 1.1, fontSize: 13, margin: 0, valign: "top", isTextBox: true });
  }
  {
    const s = slide("Retrieval lab", "RETRIEVAL LAB · LEARNING", "What feedback changes",
      "These two panels show the learning. The chart is the history of the four weights over ten feedback events, starting from an even split: similarity rose from 0.40 to about 0.48 and confidence to 0.26, while importance fell to about 0.16 and recency from 0.20 to 0.10. Nothing was hand-tuned — every move came from a helpful or not-helpful click. On the right is source reliability: every source whose trust was lowered by feedback, with its current value. 'Current attendance is 78%' is at 0.80 after I marked it as outdated in the console.");
    const r1 = framed(s, "retCurve", { x: MX, y: TOP, w: 7.7, h: 3.1 }, { align: "left", alt: "Learning curve of the weights" });
    caption(s, "How feedback moved the weights — 10 feedback events since 21 Aug", r1.x, r1.y + r1.h + 0.15, r1.w, { size: 12, color: T.text });
    callouts(s, [
      { t: "Similarity ↑ 0.40 → 0.48", d: "Feedback rewarded sources that matched the question closely.", color: T.amber },
      { t: "Recency ↓ 0.20 → 0.10", d: "Newer wasn't always better for these questions.", color: T.green },
    ], MX, r1.y + r1.h + 0.65, 7.7, { gap: 0.12, titleSize: 13, descSize: 12 });
    const x = 8.6, w = W - MX - x;
    framed(s, "retReliab", { x, y: TOP, w, h: 3.6 }, { align: "right", alt: "Source reliability panel" });
    caption(s, "Source reliability: trust lowered by feedback multiplies a source's confidence (C).", x, TOP + 3.75, w, { size: 12, h: 0.6 });
  }
  {
    const s = slide("Retrieval lab", "RETRIEVAL LAB · MEMORY CLASSIFIER", "The classifier, tested on sentences it never saw",
      "At the bottom of the lab is the memory classifier playground. Type any sentence and see its class probabilities, the topic and value it found, and any conflict — without storing anything. Next to it is a confusion matrix on 40 hand-labelled held-out sentences. The toggle switches between the rule-based baseline and the trained model. The rules get 39 of 40 — they miss 'I'm in the library at the moment', which is temporary, not persistent. The trained TF-IDF and logistic regression model gets 40 of 40. Because 40 is a small test set, the more honest number is the 5-fold cross-validation macro-F1 of 0.88 on 220 training sentences.");
    framed(s, "retClassifier", { x: MX, y: TOP, w: W - 2 * MX, h: 3.55 }, { alt: "Classifier playground and confusion matrix" });
    const stats = [
      { v: "97.5%", l: "Rules baseline", d: "39 of 40 held-out sentences · macro-F1 0.97", c: T.amber },
      { v: "100%", l: "Trained model", d: "40 of 40 · TF-IDF + logistic regression", c: T.pink },
      { v: "0.88", l: "CV macro-F1", d: "5-fold cross-validation on 220 training sentences", c: T.blue },
    ];
    const cw = 3.95, gap = 0.19, y = 5.3;
    stats.forEach((st, i) => {
      const x = MX + i * (cw + gap);
      s.addText(st.v, { x, y, w: 1.7, h: 0.75, fontSize: 32, bold: true, color: st.c, margin: 0, valign: "middle", isTextBox: true });
      s.addText([{ text: st.l, options: { bold: true, color: T.text, fontSize: 14, breakLine: true } }, { text: st.d, options: { color: T.muted, fontSize: 11 } }],
        { x: x + 1.85, y: y + 0.02, w: cw - 1.85, h: 1.2, margin: 0, valign: "top", isTextBox: true });
    });
  }

  // ======================================================== KNOWLEDGE
  {
    const s = slide("Knowledge base", "KNOWLEDGE PAGE", "The documents it answers from",
      "The knowledge page lists the documents — four seeded ones with 28 passages: Academic Regulations, Exam Guidelines, the Hostel Handbook and the CSE Handbook. Each passage shows its section, token count, a reliability meter, an embedding fingerprint — a small strip that visualises its vector — and lines like 'Overridden for minimum attendance by your correction'. You can drop in a txt, markdown or PDF file, or add the sample CSE circular. Ingestion animates the stages — add, split, embed, index — and finally reconciles the new document with memory: it either confirms a fact you told it, or resolves a conflict.");
    const steps = [
      { icon: "LuUpload", t: "Add", d: ".txt · .md · .pdf, or the sample CSE circular" },
      { icon: "LuScissors", t: "Split", d: "Sections → passages of ~110 words; claims extracted" },
      { icon: "LuBinary", t: "Embed", d: "Each passage → a 384-d vector" },
      { icon: "LuDatabase", t: "Index", d: "Stored in the Chroma vector store" },
      { icon: "LuGitBranch", t: "Reconcile", d: "Confirm a memory, or resolve a conflict" },
    ];
    const cw = 2.18, gap = 0.33, y = TOP, h = 2.4;
    for (let i = 0; i < steps.length; i++) {
      const x = MX + i * (cw + gap);
      await card(s, x, y, cw, h, { icon: steps[i].icon, kicker: `STAGE ${i + 1}`, title: steps[i].t, body: steps[i].d, titleSize: 16, bodySize: 12, iconHex: HEX.glacier, color: T.blue });
      if (i < steps.length - 1) arrow(s, x + cw + 0.04, y + h / 2, x + cw + gap - 0.04, y + h / 2, T.muted);
    }
    const panels = [
      { t: "Documents", d: "Academic Regulations 2024 (14 passages) · Exam Guidelines (6) · Hostel Handbook (5) · CSE Handbook (3)", icon: "LuBookOpen" },
      { t: "Passages", d: "Section, title, tokens, reliability meter, embedding fingerprint strip, and “Overridden for … by …” notes", icon: "LuFileText" },
      { t: "Where it sits on the map", d: "The terrain rings the selected document's passages; new hills rise when a file is added", icon: "LuMap" },
    ];
    const pw = 3.95, pg = 0.19, py = 4.25, ph = 2.45;
    for (let i = 0; i < panels.length; i++) {
      await card(s, MX + i * (pw + pg), py, pw, ph, { icon: panels[i].icon, title: panels[i].t, body: panels[i].d, titleSize: 15, bodySize: 12, iconHex: HEX.sodium, color: T.amber });
    }
  }

  // ======================================================== UNDER THE HOOD
  {
    const s = slide("Under the hood", "ARCHITECTURE", "How the pieces fit together",
      "The frontend is a Next.js and React app; the terrain is drawn with three.js and custom shaders. It talks to a FastAPI backend over REST, and the chat endpoint streams the pipeline as server-sent events, so each stage appears as it happens. In the backend, the engine runs the five steps: the classifier, the memory manager, the two-stage retriever, the generator, and learning from feedback. Memories, turns and the feedback log live in SQLite; vectors live in Chroma; embeddings come from the MiniLM sentence-transformer. The language model is pluggable: Claude, Gemini, a local model through Ollama, or template answers with no model at all.");
    const box = (x, y, w, h, t, d, color, ic) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: T.card }, line: { color, width: 1.25 } });
      s.addText([{ text: t, options: { bold: true, color: T.text, fontSize: 14, breakLine: !!d } }, ...(d ? [{ text: d, options: { color: T.muted, fontSize: 11 } }] : [])],
        { x: x + 0.15, y: y + 0.08, w: w - 0.3, h: h - 0.16, margin: 0, valign: "middle", align: "center", isTextBox: true });
    };
    // row 1: browser
    box(MX, TOP, W - 2 * MX, 0.85, "Browser — Next.js 16 · React 19 · three.js terrain · Zustand store", "Landing · Console · Memory · Retrieval lab · Knowledge", T.blue);
    arrow(s, W / 2, TOP + 0.88, W / 2, TOP + 1.3, T.muted);
    caption(s, "REST + Server-Sent Events (chat streams each stage)", W / 2 + 0.15, TOP + 0.95, 5, { size: 11 });
    // row 2: FastAPI + modules
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y: TOP + 1.35, w: W - 2 * MX, h: 2.0, rectRadius: 0.1, fill: { color: T.bg }, line: { color: T.pink, width: 1.25 } });
    caption(s, "FASTAPI BACKEND · engine.py runs the five steps", MX + 0.2, TOP + 1.45, 8, { size: 11, bold: true, color: T.pink });
    const mods = [["Classifier", "rules · ML · LLM"], ["Memory manager", "add · replace · expire"], ["Retriever", "search 12 → top 5"], ["Generator", "LLM or template"], ["Learning", "weights + reliability"]];
    const mw = 2.25, mg = 0.17;
    mods.forEach((m, i) => box(MX + 0.2 + i * (mw + mg), TOP + 1.85, mw, 1.25, m[0], m[1], T.line));
    // row 3: storage + models
    const sw = 2.9, sg = 0.21, sy = TOP + 3.85;
    for (let i = 0; i < 4; i++) arrow(s, MX + i * (sw + sg) + sw / 2, TOP + 3.38, MX + i * (sw + sg) + sw / 2, sy - 0.04, T.muted);
    [["SQLite", "memories · turns · feedback", T.amber], ["Chroma", "vector store (cosine)", T.amber], ["MiniLM embeddings", "all-MiniLM-L6-v2 · 384-d", T.green], ["LLM (pluggable)", "Claude · Gemini · Ollama · none", T.pink]]
      .forEach((b, i) => box(MX + i * (sw + sg), sy, sw, 1.05, b[0], b[1], b[2]));
    caption(s, "Storage and models — the LLM is pluggable (Claude · Gemini · Ollama · none) and is never trained.", MX, sy + 1.2, W - 2 * MX, { size: 12, italic: true });
  }
  {
    const s = slide("Under the hood", "BACKEND API", "15 endpoints, documented automatically",
      "FastAPI generates interactive API documentation at slash docs — this is a screenshot of it. There are 15 endpoints: chat, feedback, state, reset, the demo clock, reading, pinning and deleting memories, retrieval and weights for the lab, classify and classifier evaluation for the playground, document upload and the sample circular, and a health check. The chat endpoint streams Server-Sent Events in a fixed order, which is what lets the console animate each stage as it happens.");
    const r = framed(s, "apiDocs", { x: MX, y: TOP, w: 7.4, h: 5.3 }, { align: "left", alt: "FastAPI Swagger docs listing 15 endpoints" });
    marker(s, 1, r, 0.36, 0.035);
    const x = r.x + r.w + 0.7, w = W - MX - x;
    caption(s, "POST /api/chat STREAMS, IN ORDER", x, TOP, w, { size: 11, bold: true, color: T.pink });
    const ev = ["user", "classification", "memory_ops", "patch (memories, map positions)", "retrieval", "token … token", "done"];
    let cy = TOP + 0.42;
    marker(s, 2, { x: x - 0.25, y: cy, w: 0, h: 0.3 }, 0, 0.5);
    ev.forEach((e, i) => {
      pill(s, e, x, cy, Math.min(w, 3.6), i === 3 ? T.amber : T.line);
      if (i < ev.length - 1) arrow(s, x + 0.25, cy + 0.31, x + 0.25, cy + 0.47, T.muted);
      cy += 0.5;
    });
    callouts(s, [
      { t: "Interactive docs at /docs", d: "Generated from the route definitions in main.py." },
      { t: "One streamed request per turn", d: "The browser renders each event as it arrives." },
    ], x, cy + 0.2, w, { gap: 0.12, titleSize: 13, descSize: 12 });
  }
  {
    const s = slide("Under the hood", "CONNECTING A LANGUAGE MODEL", "The LLM writes the answer — it is never trained",
      "The language model is only used in step four, to write the answer from the numbered context, and optionally to classify messages. It's chosen in the backend's .env file. With an Anthropic key it uses Claude through the official SDK, with a cached system prompt, low effort and server-side refusal fallbacks. Gemini works through its OpenAI-compatible endpoint — I tested it live with gemini-3.8-flash; the free tier allows about 20 requests per model per day. A local model through Ollama also works. With none configured, template answers are built from the same retrieved context, so the whole demo still runs offline.");
    const rows = [
      ["Provider", "Set in backend/.env", "Notes"],
      ["Claude", "ANTHROPIC_API_KEY", "claude-opus-5-5 · official anthropic SDK · cached system prompt · refusal fallbacks"],
      ["Gemini", "LLM_PROVIDER=openai\nOPENAI_BASE_URL=…/v1beta/openai/", "gemini-3.8-flash · tested live · free tier ≈ 20 requests / model / day"],
      ["Ollama (local)", "OPENAI_BASE_URL=http://localhost:11434/v1", "Any local model, free, offline"],
      ["None", "—", "Template answers from the same retrieved context — the demo still works"],
    ];
    const tbl = rows.map((r, i) => r.map((c, j) => ({ text: c, options: {
      bold: i === 0 || j === 0, color: i === 0 ? T.pink : j === 0 ? T.text : T.muted, fontSize: i === 0 ? 11 : 12,
      fill: { color: i === 0 ? T.bg : T.card }, charSpacing: i === 0 ? 2 : 0 } })));
    s.addTable(tbl, { x: MX, y: TOP, w: W - 2 * MX, colW: [1.9, 4.4, 5.93], border: { type: "solid", pt: 0.75, color: T.line }, margin: 0.1, valign: "middle", rowH: [0.42, 0.72, 0.85, 0.72, 0.72] });
    const y = 5.35;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: MX, y, w: W - 2 * MX, h: 1.35, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.pink, width: 1 } });
    s.addImage({ data: await icon("LuLock", HEX.rhodamine), x: MX + 0.3, y: y + 0.42, w: 0.5, h: 0.5 });
    s.addText([
      { text: "What the model sees: ", options: { bold: true, color: T.text } },
      { text: "a fixed system prompt, the last few turns, the student's facts and style, and a numbered CONTEXT block — each item with its source, trust and any override. It must cite [n] and use only that context. If it fails, the turn falls back to the template answer.", options: { color: T.muted } },
    ], { x: MX + 1.05, y: y + 0.12, w: W - 2 * MX - 1.3, h: 1.1, fontSize: 13, margin: 0, valign: "middle", isTextBox: true });
  }
  {
    const s = slide("Under the hood", "TESTING", "Tested end to end",
      "Testing had several layers. 44 backend tests run on fast hashed embeddings and an in-memory vector store, so they need no downloads or API key. One of them is a parity test: it replays a 14-message script plus feedback, a document upload and a clock jump through both the Python backend and the browser's TypeScript engine, and checks they make exactly the same decisions, rankings and answers. Then a headless browser drove the whole nine-step demo against the real backend: 25 checks passed with zero console errors. The trained classifier scores 40 of 40 on held-out sentences, with a cross-validated macro-F1 of 0.88. And the live Gemini run produced complete, correctly cited answers.");
    const stats = [
      { v: "44", l: "backend tests pass", d: "pytest · memory manager, API routes, LLM path", c: T.pink, icon: "LuFlaskConical" },
      { v: "1 = 1", l: "parity test", d: "Python and TypeScript engines agree on a 14-message script", c: T.amber, icon: "LuScale" },
      { v: "25 / 25", l: "end-to-end checks", d: "Headless browser runs the 9-step demo · 0 console errors", c: T.blue, icon: "LuCircleCheck" },
      { v: "40 / 40", l: "held-out sentences", d: "Trained classifier (CV macro-F1 0.88)", c: T.green, icon: "LuTarget" },
    ];
    const cw = 5.95, ch = 2.45, g = 0.33;
    for (let i = 0; i < stats.length; i++) {
      const x = MX + (i % 2) * (cw + g), y = TOP + Math.floor(i / 2) * (ch + 0.25);
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: ch, rectRadius: 0.1, fill: { color: T.card }, line: { color: T.line, width: 1 } });
      s.addImage({ data: await icon(stats[i].icon, [HEX.rhodamine, HEX.sodium, HEX.glacier, HEX.vizR][i]), x: x + 0.3, y: y + 0.32, w: 0.45, h: 0.45 });
      s.addText(stats[i].v, { x: x + 0.3, y: y + 0.85, w: cw - 0.6, h: 0.85, fontSize: 44, bold: true, color: stats[i].c, margin: 0, valign: "middle", isTextBox: true });
      s.addText([{ text: stats[i].l, options: { bold: true, color: T.text, fontSize: 15, breakLine: true } }, { text: stats[i].d, options: { color: T.muted, fontSize: 12 } }],
        { x: x + 0.3, y: y + 1.7, w: cw - 0.6, h: 0.7, margin: 0, valign: "top", isTextBox: true });
    }
  }
  {
    const s = slide("Under the hood", "HONEST LIMITS", "Limitations and next steps",
      "Be upfront about limits. The classifier's test set is only 40 sentences and the training sentences were written for this project, so real student messages may be messier. There's one user and no login. The free Gemini tier limits how many live answers you can show. And reliability only changes through feedback — down when a source is rejected or marked outdated, up a little when an answer is helpful — there's no automatic fact-checking. Next steps: a larger real-world evaluation, multiple users with authentication, letting the LLM classifier and the trained model vote, and measuring answer quality, not just ranking.");
    const col = async (x, title, color, iconName, items) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: TOP, w: 5.95, h: 4.3, rectRadius: 0.1, fill: { color: T.card }, line: { color, width: 1.25 } });
      s.addImage({ data: await icon(iconName, color === T.amber ? HEX.sodium : HEX.vizR), x: x + 0.3, y: TOP + 0.3, w: 0.45, h: 0.45 });
      s.addText(title, { x: x + 0.9, y: TOP + 0.28, w: 4.8, h: 0.5, fontSize: 18, bold: true, color: T.text, margin: 0, valign: "middle", isTextBox: true });
      s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })),
        { x: x + 0.3, y: TOP + 1.0, w: 5.35, h: 3.1, fontSize: 16, color: T.muted, margin: 0, valign: "top", paraSpaceAfter: 14, isTextBox: true });
    };
    await col(MX, "Limitations", T.amber, "LuTriangleAlert", [
      "Classifier tested on only 40 held-out sentences; training data is synthetic",
      "One user, no login or per-user memory",
      "Free Gemini tier: about 20 live answers per model per day",
      "Trust only changes through feedback — no automatic fact-checking",
    ]);
    await col(MX + 6.28, "Next steps", T.green, "LuRocket", [
      "Evaluate on real student messages",
      "Multiple users with authentication and private memory",
      "Combine the trained and LLM classifiers (voting)",
      "Measure answer quality end to end, not just ranking",
    ]);
  }

  // ======================================================== Closing
  {
    pres.addSection({ title: "Close" }); section = "Close";
    const s = pres.addSlide({ masterName: "TITLE", sectionTitle: "Close" });
    s.addText("THANK YOU", { placeholder: "kicker" });
    s.addText([{ text: "Correct it once.", options: { breakLine: true } }, { text: "It remembers." }], { placeholder: "title" });
    s.addText([
      { text: "Corrections replace old facts — they don't pile up.", options: { bullet: true, color: T.text, breakLine: true } },
      { text: "Retrieval ranks on four signals the system learns from feedback.", options: { bullet: true, color: T.text, breakLine: true } },
      { text: "The language model never changes — everything around it learns.", options: { bullet: true, color: T.text, breakLine: true } },
      { text: " ", options: { fontSize: 10, breakLine: true } },
      { text: "Questions?", options: { bold: true, color: T.pink, fontSize: 24 } },
    ], { placeholder: "body" });
    framed(s, "memTerrain", { x: 7.15, y: 1.25, w: 5.65, h: 5.0 }, { valign: "middle", alt: "The knowledge terrain" });
    s.addNotes("Close with the three ideas: corrections replace instead of piling up, ranking uses four signals that are learned from feedback, and the language model is never retrained — everything around it learns. Then invite questions. If there's time, open the console and run the guided demo live.");
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT, (fs.statSync(OUT).size / 1e6).toFixed(1), "MB", pres.slides ? "" : "");
})().catch((e) => { console.error(e); process.exit(1); });
