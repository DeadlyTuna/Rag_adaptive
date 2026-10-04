import { Rail } from "@/components/shell/Rail";
import { StatusStrip } from "@/components/shell/StatusStrip";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { Toaster } from "@/components/shell/Toaster";
import { LiveRegion, StoreHydrator } from "@/components/shell/StoreHydrator";
import { MemoryDrawer } from "@/components/memory/MemoryDrawer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-16 md:pb-0 md:pl-[76px]">
      <a
        href="#content"
        className="sr-only z-[70] rounded-md bg-foam px-3 py-2 text-abyss focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Rail />
      <StatusStrip />
      <main id="content">{children}</main>
      <CommandPalette />
      <Toaster />
      <MemoryDrawer />
      <LiveRegion />
      <StoreHydrator />
    </div>
  );
}
