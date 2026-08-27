import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectLinksPanel } from "@/components/integration-gateway/project-links-panel";
import { studioProjectLinkCatalog } from "@/lib/integration-gateway/links/catalog";
import { ProjectLinkService } from "@/lib/integration-gateway/links/project-link-service";
import { projectLinksEnabled } from "@/lib/integration-gateway/links/http";
import { createClient } from "@/lib/supabase/server";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

export default async function ProjectLinksPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  if (!projectLinksEnabled()) {
    return (
      <section className="space-y-4">
        <Link href={`/dashboard/projectceo/projects/${projectId}`} className="text-sm text-muted hover:text-ink">
          ← {ru.projectCeo.actions.open}
        </Link>
        <h1 className="font-display text-3xl font-semibold">{ru.projectLinks.title}</h1>
        <p className="text-sm text-muted">{ru.projectLinks.disabled}</p>
      </section>
    );
  }

  let links;
  let access;
  try {
    const service = new ProjectLinkService(await createClient());
    [links, access] = await Promise.all([
      service.list(projectId),
      service.access(projectId),
    ]);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-5">
      <Link href={`/dashboard/projectceo/projects/${projectId}`} className="text-sm text-muted hover:text-ink">
        ← {ru.projectCeo.actions.open}
      </Link>
      <ProjectLinksPanel
        projectId={projectId}
        links={links}
        access={access}
        catalog={studioProjectLinkCatalog}
      />
    </div>
  );
}
