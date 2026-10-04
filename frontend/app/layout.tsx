import type { Metadata, Viewport } from "next";
import { Anybody, Recursive } from "next/font/google";
import "./globals.css";
import { MotionProvider } from "@/components/shell/MotionProvider";

// Display: variable-width grotesk — width carries meaning (current = wide).
const anybody = Anybody({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-anybody",
  display: "swap",
});

// Text + data: one variable family that flexes from Mono (raw input) to Sans (knowledge).
const recursive = Recursive({
  subsets: ["latin"],
  axes: ["MONO", "CASL", "CRSV", "slnt"],
  variable: "--font-recursive",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Adaptive RAG — correct it once, it remembers",
    template: "%s · Adaptive RAG",
  },
  description:
    "An assistant that answers from your documents and from what it learns in conversation. Correct a fact and it retires the old one, keeps the new one, and ranks it higher next time.",
};

export const viewport: Viewport = {
  themeColor: "#0a2327",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${anybody.variable} ${recursive.variable}`}>
      <body>
        <MotionProvider>{children}</MotionProvider>
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
