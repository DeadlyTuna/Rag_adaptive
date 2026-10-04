import type { Factor } from "./engine/types";

export const FACTOR_META: Record<Factor, { name: string; color: string; desc: string; w: string }> = {
  S: { name: "Similarity", color: "var(--color-viz-s)", desc: "How closely it matches the question", w: "w₁" },
  R: { name: "Recency", color: "var(--color-viz-r)", desc: "How recently it was learned or confirmed", w: "w₂" },
  C: { name: "Confidence", color: "var(--color-viz-c)", desc: "How reliable its source has proven", w: "w₃" },
  I: { name: "Importance", color: "var(--color-viz-i)", desc: "How much it matters when it applies", w: "w₄" },
};
