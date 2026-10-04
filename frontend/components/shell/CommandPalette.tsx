"use client";

import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Glyph } from "@/components/ui/Glyph";
import { NAV } from "./Rail";
import { DEMO_SCRIPT } from "@/lib/script";
import { DAY, HOUR } from "@/lib/engine/forget";
import { useStore } from "@/lib/store";
import { Kbd } from "@/components/ui/Button";

const item =
  "flex cursor-pointer items-center gap-3 rounded-[9px] px-3 py-2.5 text-[13.5px] text-foam aria-selected:bg-reef data-[disabled=true]:opacity-40";
const group = "px-1.5 pb-1 [&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const memories = useStore((s) => s.world.memories);
  const done = useStore((s) => s.world.scriptDone);
  const pace = useStore((s) => s.pace);
  const busy = useStore((s) => !!s.pending);

  useEffect(() => {
    let g = false;
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (g) {
        const to = NAV.find((n) => n.key.toLowerCase() === e.key.toLowerCase());
        g = false;
        if (to) {
          e.preventDefault();
          router.push(to.href);
        }
        return;
      }
      if (e.key === "g") {
        g = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => (g = false), 900);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("palette:open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("palette:open", onOpen);
    };
  }, [router]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const say = (text: string, id: string) =>
    run(() => {
      router.push("/console");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("script:run", { detail: { id, text } })), 120);
    });

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-[60] bg-abyss/70 backdrop-blur-[3px]"
      contentClassName="fixed left-1/2 top-[14vh] z-[61] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[16px] border border-shelf bg-trench shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
    >
      <Dialog.Title className="sr-only">Command palette</Dialog.Title>
      <Dialog.Description className="sr-only">Jump to a page, run a demo step, or change the demo clock.</Dialog.Description>
      <div className="flex items-center gap-3 border-b hairline px-4">
        <Glyph name="ping" className="text-sodium" />
        <Command.Input
          placeholder="Type a command or search memories…"
          className="h-13 w-full bg-transparent py-4 text-[15px] text-foam outline-none placeholder:text-kelp"
        />
        <Kbd>Esc</Kbd>
      </div>
      <Command.List className="max-h-[56vh] overflow-y-auto pb-2">
        <Command.Empty className="px-4 py-6 text-sm text-kelp">No matching commands.</Command.Empty>

        <Command.Group heading="Go to" className={group}>
          <Command.Item className={item} onSelect={() => run(() => router.push("/"))}>
            <Glyph name="ping" className="text-kelp" /> How it learns
          </Command.Item>
          {NAV.map((n) => (
            <Command.Item key={n.href} className={item} onSelect={() => run(() => router.push(n.href))}>
              <Glyph name={n.glyph} className="text-kelp" /> {n.label}
              <span className="ml-auto flex gap-1">
                <Kbd>G</Kbd>
                <Kbd>{n.key}</Kbd>
              </span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Demo script" className={group}>
          {DEMO_SCRIPT.filter((s) => s.kind === "say").map((s, i) => (
            <Command.Item
              key={s.id}
              value={`script ${s.text}`}
              disabled={busy}
              className={item}
              onSelect={() => say(s.text, s.id)}
            >
              <span className="data w-5 text-kelp">{i + 1}</span>
              <span className="flex-1 truncate">{s.text}</span>
              {done.includes(s.id) && <Glyph name="confirm" className="text-kelp" />}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Time" className={group}>
          {[
            { label: "Advance the clock by an hour", ms: HOUR },
            { label: "Advance the clock by a day", ms: DAY },
            { label: "Advance the clock by a week", ms: 7 * DAY },
          ].map((t) => (
            <Command.Item key={t.label} className={item} disabled={busy} onSelect={() => run(() => useStore.getState().advance(t.ms))}>
              <Glyph name="temporary" className="text-kelp" /> {t.label}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Presentation" className={group}>
          <Command.Item className={item} onSelect={() => run(() => useStore.getState().setPace(pace === 1 ? 0.45 : 1))}>
            <Glyph name="ping" className="text-kelp" />
            {pace === 1 ? "Speed up the pipeline animation" : "Use the normal pipeline speed"}
          </Command.Item>
          <Command.Item
            className={item}
            onSelect={() =>
              run(() => {
                if (window.confirm("Reset the demo? Everything learned in this session is cleared.")) useStore.getState().reset();
              })
            }
          >
            <Glyph name="expired" className="text-kelp" /> Reset demo
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Memories" className={group}>
          {memories.map((m) => (
            <Command.Item
              key={m.id}
              value={`memory ${m.text} ${m.label}`}
              className={item}
              onSelect={() =>
                run(() => {
                  router.push("/memory");
                  useStore.getState().openMemory(m.id);
                })
              }
            >
              <Glyph name={m.status === "current" ? (m.cls === "correction" ? "correction" : m.cls) : "outdated"} className="text-kelp" />
              <span className="flex-1 truncate">{m.text}</span>
              <span className="label">{m.status}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
