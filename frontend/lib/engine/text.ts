// Text normalisation shared by the embedder and the classifier.
// Small, deterministic, and tuned for the university-regulations domain.

const PHRASES: [RegExp, string][] = [
  [/\bfinal assessment tests?\b/g, " fat "],
  [/\bcontinuous assessment tests?\b/g, " cat "],
  [/\bhall[- ]tickets?\b/g, " hallticket "],
  [/\badmit[- ]cards?\b/g, " hallticket "],
  [/\bstep[- ]by[- ]step\b/g, " stepbystep "],
  [/\bre[- ]?exam(ination)?s?\b/g, " reexam "],
  [/\bmake[- ]?up\b/g, " makeup "],
  [/\bin[- ]time\b/g, " curfew "],
  [/\blast date\b/g, " deadline "],
  [/\bend[- ]sem(ester)?\b/g, " fat "],
  [/\bsmart ?watch(es)?\b/g, " smartwatch "],
  [/(\d+(?:\.\d+)?)\s*%/g, " $1 percent "],
];

const STOP = new Set(
  (
    "the a an is are was were be been being to of and or in on for with what whats which who whom how do does did " +
    "doing i me my mine you your yours it its that this these those can could would should will shall may might am " +
    "at by from as so if then than there here their they them we our us he she his her about into up out any all " +
    "some just also please tell know get got go going much many more most very really thing things one ones each " +
    "every only other own same such nor too don dont now when where why let lets im ive id youre theyre isnt arent " +
    "wasnt werent hasnt havent doesnt didnt cant couldnt wont wouldnt shouldnt ok okay hi hello hey thanks thank yes " +
    "yeah yep sure actually so well hmm oh like just still even again ever"
  ).split(" "),
);

const SYN: Record<string, string> = {};
function syn(canon: string, words: string) {
  for (const w of words.split(" ")) SYN[w] = canon;
}
syn("attendance", "attendance attend attended attending presence present");
syn("require", "minimum min least required requirement requirements require need needed needs mandatory must");
syn("fat", "fat fats final finals endsem");
syn("cat", "cat cats");
syn("eligible", "eligible eligibility allowed allow qualify qualified write writing sit appear");
syn("exam", "exam exams examination examinations test tests assessment assessments quiz quizzes");
syn("pass", "pass passing passed");
syn("marks", "mark marks score scores scored scoring");
syn("grade", "grade grades grading gpa cgpa");
syn("fee", "fee fees payment pay paid dues");
syn("deadline", "deadline deadlines due");
syn("library", "library libraries");
syn("hours", "hours hour timing timings open opens close closes closing closed");
syn("hostel", "hostel hostels dorm");
syn("curfew", "curfew return late");
syn("department", "department departments dept branch");
syn("debar", "debar debarred barred detained detention");
syn("condone", "condonation condone condoned medical");
syn("percent", "percent percentage");
syn("prefer", "prefer preference preferences want");
syn("concise", "concise short shorter brief briefly");
syn("detailed", "detailed detail stepbystep steps step elaborate explanation explanations");
syn("name", "name called");
syn("reexam", "reexam supplementary arrear arrears");
syn("makeup", "makeup");
syn("hallticket", "hallticket");
syn("calculator", "calculator calculators");
syn("mess", "mess food breakfast lunch dinner meal meals");
syn("visitor", "visitor visitors guest guests");
syn("lab", "lab labs laboratory practical practicals record records viva");
syn("project", "project projects review reviews");
syn("semester", "semester semesters sem");
syn("credit", "credit credits");
syn("malpractice", "malpractice cheating copying unauthorised");
syn("result", "result results");
syn("leave", "leave");
syn("change", "changed change changes updated update revised raised increased lowered reduced moved extended");

/** Generic tokens carry less meaning — down-weight them in the embedding. */
export const TOKEN_WEIGHT: Record<string, number> = {
  exam: 0.6,
  require: 0.5,
  student: 0.35,
  students: 0.35,
  course: 0.4,
  courses: 0.4,
  semester: 0.5,
  change: 0.35,
  percent: 0.55,
  marks: 0.8,
  hours: 0.8,
  university: 0.4,
};

export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function canon(word: string): string {
  if (SYN[word]) return SYN[word];
  const s = stem(word);
  return SYN[s] ?? s;
}

/** Content tokens (canonicalised, stop-words removed). Numbers become `#80`. */
export function tokens(text: string): string[] {
  let t = text.toLowerCase().replace(/[’‘]/g, "'");
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  t = t.replace(/'/g, "");
  const out: string[] = [];
  for (const raw of t.split(/[^a-z0-9.]+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (!w) continue;
    if (/^\d+(\.\d+)?$/.test(w)) {
      out.push("#" + w);
      continue;
    }
    if (STOP.has(w) || w.length < 2) continue;
    out.push(canon(w));
  }
  return out;
}

export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.endsWith("?")) return true;
  return /^(what|whats|what's|when|where|which|who|whom|why|how|can|could|should|would|is|are|am|do|does|did|will|shall|may|tell me)\b/.test(
    t,
  );
}

export function sentences(text: string): string[] {
  // punctuation followed by a non-space (7.5, 9:30, e.g.) stays inside the sentence
  return (text.match(/(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+|$)/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

export function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
