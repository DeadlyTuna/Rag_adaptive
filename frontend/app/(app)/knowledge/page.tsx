import type { Metadata } from "next";
import { KnowledgeView } from "@/components/knowledge/KnowledgeView";

export const metadata: Metadata = { title: "Knowledge base" };

export default function KnowledgePage() {
  return <KnowledgeView />;
}
