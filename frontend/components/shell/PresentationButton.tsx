"use client";

// Opens the feature-tour presentation (presentation/ in the repo, copied to public/) in a
// viewer over the page, with links to download it as PDF or PowerPoint.

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Download, Presentation, X } from "lucide-react";
import { cx } from "@/lib/format";

const BASE = "/presentation/Adaptive-RAG-Feature-Tour";

export function PresentationButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-2 rounded-[9px] border border-shelf bg-trench/70 pl-2.5 pr-2.5 text-[12.5px] text-kelp transition-colors hover:border-kelp/50 hover:text-foam"
        >
          <Presentation size={14} strokeWidth={1.8} />
          <span className="hidden sm:inline">Presentation</span>
        </button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[60] bg-abyss/70 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-x-3 bottom-3 top-14 z-[61] flex flex-col overflow-hidden rounded-[16px] border border-shelf bg-trench shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] outline-none sm:inset-x-8 sm:bottom-6 sm:top-16"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <header className="flex flex-wrap items-center gap-3 border-b hairline px-4 py-2.5">
                  <Dialog.Title className="label text-foam">Feature tour · 33 slides</Dialog.Title>
                  <div className="ml-auto flex items-center gap-2">
                    <a
                      href={`${BASE}.pdf`}
                      download
                      className={cx("inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-shelf px-2.5 text-[12.5px] text-kelp hover:border-kelp/50 hover:text-foam")}
                    >
                      <Download size={13} /> PDF
                    </a>
                    <a
                      href={`${BASE}.pptx`}
                      download
                      className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-shelf px-2.5 text-[12.5px] text-kelp hover:border-kelp/50 hover:text-foam"
                    >
                      <Download size={13} /> PowerPoint
                    </a>
                    <Dialog.Close asChild>
                      <button type="button" aria-label="Close presentation" className="grid h-8 w-8 place-items-center rounded-lg text-kelp hover:bg-reef hover:text-foam">
                        <X size={16} />
                      </button>
                    </Dialog.Close>
                  </div>
                </header>
                <iframe title="Adaptive RAG feature tour" src={`${BASE}.pdf`} className="min-h-0 flex-1 bg-abyss" />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
