import { notFound } from "next/navigation";

import { LayoutStudioShell } from "@/components/layout-studio/layout-studio-shell";
import fixture from "@/fixtures/layout-studio/liquid-station.synthetic.v0.1.json";
import { isLayoutStudioEnabled } from "@/lib/layout-studio/feature-flag";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

export const dynamic = "force-dynamic";

export default function LayoutStudioPage() {
  if (!isLayoutStudioEnabled()) notFound();

  return <LayoutStudioShell initialDocument={fixture as unknown as LayoutDocument} />;
}
