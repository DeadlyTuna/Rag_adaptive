// The guided demo: the brief's interaction story, one chip per step.

export interface ScriptStep {
  id: string;
  kind: "say" | "jump";
  text: string;
  hint: string;
}

export const DEMO_SCRIPT: ScriptStep[] = [
  { id: "ask", kind: "say", text: "What is the minimum attendance requirement?", hint: "Answers from the regulations: 75%" },
  { id: "correct", kind: "say", text: "Our department changed it to 80% last semester.", hint: "Detected as a correction — replaces 75%" },
  { id: "fat", kind: "say", text: "When can I write my FAT?", hint: "Uses your correction, not the PDF" },
  { id: "concise", kind: "say", text: "I prefer concise answers.", hint: "Replaces your step-by-step preference" },
  { id: "exam", kind: "say", text: "I have a DBMS exam tomorrow.", hint: "Kept only until the exam is over" },
  { id: "math", kind: "say", text: "What's 2+2?", hint: "Answered, but not worth storing" },
  { id: "mine", kind: "say", text: "My attendance is 78%.", hint: "Remembered about you" },
  { id: "eligible", kind: "say", text: "Am I eligible for FAT?", hint: "Reasons from everything it learned" },
  { id: "jump", kind: "jump", text: "Skip past the exam", hint: "The temporary memory expires" },
];
