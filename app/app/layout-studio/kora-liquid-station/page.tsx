import { notFound } from "next/navigation";
import fixture from "@/fixtures/layout-studio/kora-liquid-station.v0.1.json";
import { LayoutStudioShell } from "@/components/layout-studio/layout-studio-shell";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

export const dynamic = "force-dynamic";
export default function KoraLayoutStudioPage() {
  if (process.env.ARCHIDOM_LAYOUT_STUDIO_ENABLED !== "true") notFound();
  return <LayoutStudioShell initialDocument={fixture as LayoutDocument} />;
}
