import { notFound } from "next/navigation";
import fixture from "@/fixtures/layout-studio/kora-liquid-station.v0.1.json";
import { LayoutStudioShell } from "@/components/layout-studio/layout-studio-shell";
import { isLayoutStudioEnabled } from "@/lib/layout-studio/feature-flag";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

export const dynamic = "force-dynamic";
export default function KoraLayoutStudioPage() {
  if (!isLayoutStudioEnabled()) notFound();
  return <LayoutStudioShell initialDocument={fixture as unknown as LayoutDocument} />;
}
