"use client";

// One store for the whole app. The engine computes a message's full result up front;
// the store then *releases* it in stages (classify → remember → retrieve → stream) so
// every part of the UI can animate the moment it happens. Same stages in live mode.

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ActivityEvent, EventType, Feedback, Turn, Weights, World } from "./engine/types";
import { createWorld, WORLD_VERSION } from "./engine/seed";
import {
  applyFeedback,
  deleteMemory,
  ingest as ingestDocument,
  markOutdated,
  processMessage,
  tick,
  togglePin,
  uid,
} from "./engine/engine";
import { normalise } from "./engine/learn";
import type { SeedDocument } from "./engine/corpus";
import { ApiError, LIVE, live, streamChat } from "./api/live";
import type { IngestResult, ServerWorld, WorldPatch } from "./api/live";

export type Stage = "classifying" | "remembering" | "retrieving" | "generating";

export interface Toast {
  id: string;
  type: EventType;
  title: string;
  detail: string;
  refId?: string;
}

export interface Pulse {
  key: number;
  ids: string[];
  kind: "new" | "replace" | "expire" | "flag" | "confirm" | "ingest";
}

export interface Ping {
  key: number;
  pos: [number, number];
  ids: string[];
}

interface Persisted {
  world: World;
  clockOffset: number;
  pace: number;
}

export interface AppState extends Persisted {
  hydrated: boolean;
  pending: { userId: string; assistantId: string; stage: Stage } | null;
  stream: { turnId: string; chars: number } | null;
  selectedTurnId: string | null;
  hoverId: string | null;
  drawerId: string | null;
  toasts: Toast[];
  announce: string;
  ping: Ping | null;
  pulse: Pulse | null;

  now: () => number;
  send: (text: string) => Promise<void>;
  skip: () => void;
  feedback: (turnId: string, verdict: Feedback["verdict"], reason?: Feedback["reason"], targetId?: string) => Feedback | null;
  advance: (ms: number) => void;
  advanceTo: (t: number) => void;
  tickNow: () => void;
  pin: (id: string) => void;
  outdate: (id: string) => void;
  remove: (id: string) => void;
  ingest: (doc: SeedDocument) => { chunkIds: string[]; events: ActivityEvent[] };
  setWeights: (w: Weights, label: string) => void;
  reset: () => void;
  /** Live mode: pull the server's world (GET /api/state) and merge it in. */
  refresh: (opts?: { toast?: boolean }) => Promise<void>;
  /** Live mode: index the sample circular on the server. */
  ingestSampleLive: () => Promise<IngestResult | null>;
  /** Live mode: show the result of an upload the page already sent. */
  applyIngest: (r: IngestResult) => Promise<void>;
  selectTurn: (id: string | null) => void;
  hover: (id: string | null) => void;
  openMemory: (id: string | null) => void;
  markStep: (id: string) => void;
  dismissToast: (id: string) => void;
  setPace: (p: number) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let skipping = false;
let pulseKey = 1;
// Orders /api/state responses: a refresh only applies if nothing newer has happened since
// it was sent (a later refresh, or a local change such as new weights or a reset).
let stateSeq = 0;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function toToasts(events: ActivityEvent[]): Toast[] {
  return events
    .filter((e) => e.type !== "document.indexed")
    .map((e) => ({ id: e.id, type: e.type, title: e.title, detail: e.detail, refId: e.refId }));
}

/**
 * Turns the client made that the server never kept: a failed turn is rolled back on the
 * server, but the error (and the message that caused it) should stay on screen.
 */
function keepLocalTurns(local: Turn[], server: Turn[]): Turn[] {
  const known = new Set(server.map((t) => t.id));
  const failed = local.filter((t) => !known.has(t.id) && t.status === "error");
  if (!failed.length) return server;
  const asked = new Set(failed.map((t) => t.replyTo));
  const extra = local.filter((t) => !known.has(t.id) && (t.status === "error" || asked.has(t.id)));
  return [...server, ...extra].sort((a, b) => a.at - b.at);
}

/** Clean up a world restored mid-animation (e.g. the page was refreshed while streaming). */
function settle(world: World): World {
  const turns = [...world.turns];
  while (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  return {
    ...world,
    turns: turns.map((t) => (t.role === "assistant" && t.status !== "done" && t.status !== "error" ? { ...t, status: "done" } : t)),
  };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const wait = async (ms: number) => {
        if (skipping) return;
        await sleep(ms * get().pace * (reducedMotion() ? 0.35 : 1));
      };

      const pushToasts = (events: ActivityEvent[]) => {
        const add = toToasts(events);
        if (!add.length) return;
        set((s) => ({ toasts: [...s.toasts, ...add].slice(-3), announce: add.map((t) => `${t.title}: ${t.detail}`).join(". ") }));
      };

      /** Record events the server reported in a response, and toast them. */
      const takeEvents = (events: ActivityEvent[]) => {
        const known = new Set(get().world.events.map((e) => e.id));
        const fresh = events.filter((e) => !known.has(e.id));
        if (!fresh.length) return;
        set((s) => ({ world: { ...s.world, events: [...s.world.events, ...fresh] } }));
        pushToasts(fresh);
      };

      /** Take the server's world, keeping what only the client knows (script progress, failed turns). */
      const applyServerWorld = (server: ServerWorld, opts: { toast?: boolean; scriptDone?: string[] } = {}) => {
        const { clockOffset, serverNow, ...world } = server;
        void clockOffset;
        const local = get().world;
        const known = new Set(local.events.map((e) => e.id));
        const fresh = world.events.filter((e) => !known.has(e.id));
        set({
          world: {
            ...world,
            scriptDone: opts.scriptDone ?? local.scriptDone,
            turns: get().pending ? local.turns : keepLocalTurns(local.turns, world.turns),
          },
          clockOffset: serverNow - Date.now(),
        });
        if (opts.toast !== false) pushToasts(fresh);
      };

      const applyPatch = (p: WorldPatch) =>
        set((s) => {
          const changed = new Map(p.chunks.map((c) => [c.id, c]));
          return {
            world: {
              ...s.world,
              memories: p.memories,
              chunks: s.world.chunks.map((c) => changed.get(c.id) ?? c),
              positions: { ...s.world.positions, ...p.positions },
            },
          };
        });

      const liveError = (what: string) => (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        set((s) => ({
          toasts: [...s.toasts, { id: uid("toast"), type: "memory.flagged" as EventType, title: `${what} failed`, detail: msg }].slice(-3),
          announce: `${what} failed: ${msg}`,
        }));
      };

      const sendDemo = async (text: string) => {
        const s = get();
        const t0 = s.now();
        const W0 = s.world;
        const r = processMessage(W0, text, t0);
        const user = r.user;
        const asst = r.assistant;
        const isQ = !!user.classification?.isQuestion;

        // 1 · your message appears, raw
        set({
          world: { ...W0, turns: [...W0.turns, { ...user, classification: undefined, memoryOps: undefined }] },
          pending: { userId: user.id, assistantId: asst.id, stage: "classifying" },
          selectedTurnId: null,
        });
        await wait(950);

        // 2 · the classifier's verdict
        set((st) => ({ world: { ...st.world, turns: [...W0.turns, { ...user, memoryOps: undefined }] } }));
        await wait(isQ ? 700 : 1500);

        // 3 · memory changes land (terrain reshapes)
        set({
          world: { ...r.world, turns: [...W0.turns, user] },
          pending: { userId: user.id, assistantId: asst.id, stage: "remembering" },
        });
        const touched = r.ops.flatMap((o) => [o.memoryId, o.previousId]).filter(Boolean) as string[];
        if (touched.length) {
          set({
            pulse: { key: pulseKey++, ids: touched, kind: r.ops.some((o) => o.kind === "replace") ? "replace" : r.ops[0].kind === "flag" ? "flag" : "new" },
            announce: r.ops.map((o) => `${o.title}${o.detail ? ` — ${o.detail}` : ""}`).join(". "),
          });
        }
        if (r.events.some((e) => e.type === "memory.expired")) pushToasts(r.events.filter((e) => e.type === "memory.expired"));
        await wait(touched.length ? 1150 : 250);

        // 4 · retrieval: the ping, the ranked context
        const retrieving: Turn = { ...asst, status: "retrieving" };
        set({
          world: { ...r.world, turns: [...W0.turns, user, retrieving] },
          pending: { userId: user.id, assistantId: asst.id, stage: "retrieving" },
          selectedTurnId: asst.id,
          ping: asst.retrieval?.candidates.length
            ? { key: pulseKey++, pos: asst.retrieval.ping, ids: asst.retrieval.candidates.map((c) => c.id) }
            : get().ping,
        });
        await wait(asst.retrieval?.candidates.length ? 1150 : 300);

        // 5 · the answer streams
        set({
          world: { ...r.world, turns: [...W0.turns, user, { ...asst, status: "streaming" }] },
          pending: { userId: user.id, assistantId: asst.id, stage: "generating" },
          stream: { turnId: asst.id, chars: 0 },
        });
        const tokens = asst.text.match(/\S+\s*/g) ?? [asst.text];
        let chars = 0;
        for (const tok of tokens) {
          if (skipping) break;
          chars += tok.length;
          set({ stream: { turnId: asst.id, chars } });
          await wait(/\[\d+\]/.test(tok) ? 95 : 30 + Math.random() * 26);
        }

        set({ world: r.world, stream: null, pending: null });
      };

      const sendLive = async (text: string) => {
        const t0 = get().now();
        const userId = uid("turn");
        const asstId = uid("turn");
        const W0 = get().world;
        const userTurn: Turn = { id: userId, role: "user", text, at: t0 };
        let assistant: Turn = { id: asstId, role: "assistant", text: "", at: t0 + 1, replyTo: userId, status: "retrieving" };
        const put = (u: Turn, a?: Turn) => set((s) => ({ world: { ...s.world, turns: [...W0.turns, u, ...(a ? [a] : [])] } }));
        set({ pending: { userId, assistantId: asstId, stage: "classifying" }, selectedTurnId: null });
        put(userTurn);
        let u = userTurn;
        let finished = false;
        try {
          await streamChat(text, { sessionId: "demo", userTurnId: userId, assistantTurnId: asstId }, (e) => {
            switch (e.type) {
              case "user":
                u = { ...e.turn, classification: u.classification, memoryOps: u.memoryOps };
                put(u);
                break;
              case "stage":
                set((s) => ({ pending: s.pending ? { ...s.pending, stage: e.stage } : null }));
                break;
              case "classification":
                u = { ...u, classification: e.classification };
                put(u);
                break;
              case "memory_ops":
                u = { ...u, memoryOps: e.ops };
                put(u);
                break;
              case "patch": {
                applyPatch(e);
                takeEvents(e.events);
                const ops = u.memoryOps ?? [];
                const touched = ops.flatMap((o) => [o.memoryId, o.previousId]).filter(Boolean) as string[];
                if (touched.length) {
                  set({
                    pulse: { key: pulseKey++, ids: touched, kind: ops.some((o) => o.kind === "replace") ? "replace" : ops[0].kind === "flag" ? "flag" : "new" },
                    announce: ops.map((o) => `${o.title}${o.detail ? ` — ${o.detail}` : ""}`).join(". "),
                  });
                }
                break;
              }
              case "retrieval":
                // provisional citations: every candidate by its rank, so chips render while streaming
                assistant = { ...assistant, retrieval: e.retrieval, citations: e.retrieval.candidates.map((c) => ({ n: c.rank, itemId: c.id })) };
                put(u, assistant);
                set({
                  selectedTurnId: assistant.id,
                  ping: e.retrieval.candidates.length ? { key: pulseKey++, pos: e.retrieval.ping, ids: e.retrieval.candidates.map((c) => c.id) } : get().ping,
                });
                break;
              case "token":
                assistant = { ...assistant, status: "streaming", text: assistant.text + e.text };
                put(u, assistant);
                break;
              case "done":
                assistant = { ...e.turn, status: "done" };
                finished = true;
                put(u, assistant);
                break;
              case "error":
                throw new Error(e.message);
            }
          });
          if (!finished) throw new Error("The connection closed before the answer finished.");
        } catch (err) {
          assistant = { ...assistant, status: "error", error: err instanceof Error ? err.message : String(err) };
          put(u, assistant);
        } finally {
          set({ pending: null, stream: null });
        }
        // always resync: a failed turn is rolled back on the server, so the patch it sent is void.
        // refresh() swallows its own errors, so it can't turn a finished answer into an error.
        await get().refresh();
      };

      return {
        hydrated: false,
        world: createWorld(Date.now()),
        clockOffset: 0,
        pace: 1,
        pending: null,
        stream: null,
        selectedTurnId: null,
        hoverId: null,
        drawerId: null,
        toasts: [],
        announce: "",
        ping: null,
        pulse: null,

        now: () => Date.now() + get().clockOffset,

        send: async (text) => {
          if (get().pending || !text.trim()) return;
          skipping = false;
          try {
            if (LIVE) await sendLive(text.trim());
            else await sendDemo(text.trim());
          } finally {
            skipping = false;
          }
        },

        skip: () => {
          if (get().pending) skipping = true;
        },

        feedback: (turnId, verdict, reason, targetId) => {
          if (get().pending) return null;
          if (LIVE) {
            const show = (fb: Feedback, weights?: Weights) =>
              set((s) => ({
                world: {
                  ...s.world,
                  weights: weights ?? s.world.weights,
                  turns: s.world.turns.map((t) => (t.id === turnId ? { ...t, feedback: fb } : t)),
                },
                pulse: fb.reliability ? { key: pulseKey++, ids: [fb.reliability.id], kind: "flag" } : s.pulse,
              }));
            live
              .feedback({ turn_id: turnId, verdict, reason, target_id: targetId })
              .then((r) => {
                show(r.feedback, r.weights);
                takeEvents(r.events);
              })
              .catch((err) => {
                // 409: this answer already has feedback — show the one the server kept
                const kept = err instanceof ApiError && err.status === 409 ? (err.body as { feedback?: Feedback } | null)?.feedback : undefined;
                if (kept) show(kept);
                else liveError("Feedback")(err);
              })
              .then(() => get().refresh());
            return null;
          }
          const r = applyFeedback(get().world, turnId, verdict, reason, targetId, get().now());
          set({ world: r.world });
          if (r.feedback.reliability) set({ pulse: { key: pulseKey++, ids: [r.feedback.reliability.id], kind: "flag" } });
          pushToasts(r.events);
          return r.feedback;
        },

        advance: (ms) => {
          if (get().pending) return;
          set((s) => ({ clockOffset: s.clockOffset + ms }));
          if (LIVE) {
            live
              .clock(ms)
              .then((r) => {
                set({ clockOffset: r.now - Date.now() });
                if (r.expired.length) set({ pulse: { key: pulseKey++, ids: r.expired, kind: "expire" } });
                takeEvents(r.events);
                return get().refresh();
              })
              .catch(liveError("Moving the clock"));
            return;
          }
          get().tickNow();
        },

        advanceTo: (t) => get().advance(Math.max(0, t - get().now())),

        tickNow: () => {
          if (get().pending || LIVE) return;
          const r = tick(get().world, get().now());
          if (!r.events.length) return;
          set({ world: r.world, pulse: { key: pulseKey++, ids: r.expired, kind: "expire" } });
          pushToasts(r.events);
        },

        pin: (id) => {
          if (get().pending) return;
          if (LIVE) {
            const m = get().world.memories.find((x) => x.id === id);
            live
              .patchMemory(id, { pinned: !m?.pinned })
              .then(() => get().refresh())
              .catch(liveError("Pinning"));
            return;
          }
          const r = togglePin(get().world, id, get().now());
          set({ world: r.world });
          pushToasts(r.events);
        },
        outdate: (id) => {
          if (get().pending) return;
          if (LIVE) {
            live
              .patchMemory(id, { status: "outdated" })
              .then(() => {
                set({ pulse: { key: pulseKey++, ids: [id], kind: "replace" } });
                return get().refresh();
              })
              .catch(liveError("Marking outdated"));
            return;
          }
          const r = markOutdated(get().world, id, get().now());
          set({ world: r.world, pulse: { key: pulseKey++, ids: [id], kind: "replace" } });
          pushToasts(r.events);
        },
        remove: (id) => {
          if (get().pending) return;
          if (LIVE) {
            live
              .deleteMemory(id)
              .then(() => {
                set((s) => ({ drawerId: s.drawerId === id ? null : s.drawerId }));
                return get().refresh();
              })
              .catch(liveError("Deleting"));
            return;
          }
          const r = deleteMemory(get().world, id, get().now());
          set({ world: r.world, drawerId: get().drawerId === id ? null : get().drawerId });
          pushToasts(r.events);
        },

        ingest: (doc) => {
          if (get().pending) return { chunkIds: [], events: [] };
          const r = ingestDocument(get().world, doc, get().now());
          if (!r.chunkIds.length) return { chunkIds: [], events: [] };
          set({ world: r.world, pulse: { key: pulseKey++, ids: r.chunkIds, kind: "ingest" } });
          pushToasts(r.events);
          return { chunkIds: r.chunkIds, events: r.events };
        },

        setWeights: (w, label) => {
          if (get().pending) return;
          const weights = normalise(w);
          if (LIVE) {
            stateSeq++;
            set((s) => ({ world: { ...s.world, weights } }));
            live
              .weights(weights, label)
              .then(() => get().refresh())
              .catch(liveError("Saving the weights"));
            return;
          }
          const now = get().now();
          const event: ActivityEvent = { id: uid("ev"), type: "weights.updated", at: now, title: "Ranking weights updated", detail: label };
          set((s) => ({
            world: {
              ...s.world,
              weights,
              weightHistory: [...s.world.weightHistory, { at: now, weights, label }],
              events: [...s.world.events, event],
            },
          }));
          pushToasts([event]);
        },

        reset: () => {
          skipping = true;
          set({
            world: createWorld(Date.now()),
            clockOffset: 0,
            pending: null,
            stream: null,
            toasts: [],
            selectedTurnId: null,
            drawerId: null,
            hoverId: null,
            ping: null,
            pulse: null,
            announce: "Demo reset to its starting state.",
          });
          setTimeout(() => (skipping = false), 50);
          if (LIVE) {
            stateSeq++;
            live
              .reset()
              .then((server) => applyServerWorld(server, { toast: false, scriptDone: [] }))
              .catch(liveError("Reset"));
          }
        },

        refresh: async (opts) => {
          if (!LIVE) return;
          const seq = ++stateSeq;
          try {
            const server = await live.state();
            if (seq !== stateSeq) return; // something newer happened while this was in flight
            if (get().pending) return; // a turn started meanwhile; its own refresh follows
            applyServerWorld(server, opts);
          } catch {
            // the backend is unreachable — keep showing what we have; the next poll retries
          }
        },

        ingestSampleLive: async () => {
          if (!LIVE || get().pending) return null;
          try {
            const r = await live.ingestSample();
            await get().applyIngest(r);
            return r;
          } catch (err) {
            liveError("Adding the sample")(err);
            return null;
          }
        },

        applyIngest: async (r) => {
          const ids = r.chunks.map((c) => c.id);
          if (ids.length) set({ pulse: { key: pulseKey++, ids, kind: "ingest" } });
          takeEvents(r.events);
          await get().refresh();
        },

        selectTurn: (id) => set({ selectedTurnId: id }),
        hover: (id) => set({ hoverId: id }),
        openMemory: (id) => set({ drawerId: id }),
        markStep: (id) =>
          set((s) => (s.world.scriptDone.includes(id) ? s : { world: { ...s.world, scriptDone: [...s.world.scriptDone, id] } })),
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
        setPace: (p) => set({ pace: p }),
      };
    },
    {
      name: "adaptive-rag",
      version: WORLD_VERSION,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s): Persisted => ({ world: s.world, clockOffset: s.clockOffset, pace: s.pace }),
      migrate: () => ({ world: createWorld(Date.now()), clockOffset: 0, pace: 1 }) as Persisted,
      merge: (persisted, current) => {
        const p = persisted as Partial<Persisted> | undefined;
        if (!p?.world || p.world.version !== WORLD_VERSION) return current;
        return { ...current, ...p, world: settle(p.world) };
      },
      onRehydrateStorage: () => () => {
        useStore.setState({ hydrated: true });
      },
    },
  ),
);

// ------------------------------------------------------------------- hooks

export function useHydrated() {
  return useStore((s) => s.hydrated);
}

/** Demo-clock time, re-rendering every `interval` ms. */
export function useNow(interval = 1000) {
  const offset = useStore((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now + offset;
}
