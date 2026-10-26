import type { GlyphName } from "@/components/ui/Glyph";
import type { EventType } from "./engine/types";

export const EVENT_GLYPH: Record<EventType, { glyph: GlyphName; tone: string; sign: string }> = {
  "memory.added": { glyph: "added", tone: "text-rhodamine", sign: "+" },
  "memory.preference": { glyph: "added", tone: "text-rhodamine", sign: "+" },
  "memory.replaced": { glyph: "correction", tone: "text-sodium", sign: "↻" },
  "memory.expired": { glyph: "expired", tone: "text-kelp", sign: "×" },
  "memory.reinforced": { glyph: "confirm", tone: "text-rhodamine", sign: "✓" },
  "memory.flagged": { glyph: "flag", tone: "text-flare", sign: "!" },
  "memory.pinned": { glyph: "pin", tone: "text-foam", sign: "•" },
  "memory.deleted": { glyph: "expired", tone: "text-kelp", sign: "×" },
  "memory.outdated": { glyph: "outdated", tone: "text-kelp", sign: "−" },
  "memory.confirmed": { glyph: "confirm", tone: "text-glacier", sign: "✓" },
  "weights.updated": { glyph: "weights", tone: "text-foam", sign: "⚖" },
  "document.indexed": { glyph: "document", tone: "text-glacier", sign: "+" },
  "document.conflict": { glyph: "correction", tone: "text-sodium", sign: "↻" },
  "memory.quarantined": { glyph: "flag", tone: "text-sodium", sign: "?" },
  "memory.verified": { glyph: "confirm", tone: "text-glacier", sign: "✓" },
  "memory.rejected": { glyph: "outdated", tone: "text-flare", sign: "×" },
  "memory.corroborated": { glyph: "confirm", tone: "text-rhodamine", sign: "+1" },
  "memory.merged": { glyph: "memory", tone: "text-foam", sign: "⇢" },
  "memory.archived": { glyph: "expired", tone: "text-kelp", sign: "↓" },
  "memory.scheduled": { glyph: "temporary", tone: "text-sodium", sign: "⏱" },
  "trust.propagated": { glyph: "flag", tone: "text-flare", sign: "≈" },
  "reminder.due": { glyph: "temporary", tone: "text-sodium", sign: "!" },
};
