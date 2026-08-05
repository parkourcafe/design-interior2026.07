import { redirect } from "next/navigation";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export default function LayoutStudioIndexPage() {
  if (process.env.ARCHIDOM_LAYOUT_STUDIO_ENABLED !== "true") notFound();
  redirect("/app/layout-studio/kora-liquid-station");
}
