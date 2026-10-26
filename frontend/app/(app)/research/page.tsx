import type { Metadata } from "next";
import { ResearchView } from "@/components/research/ResearchView";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage() {
  return <ResearchView />;
}
