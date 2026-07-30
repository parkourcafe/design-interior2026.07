import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PROJECTCEO_ROLES,
  type ProjectCeoRole,
} from "@/components/projectceo/contracts";
import {
  createProjectCeoMockPort,
  KORA_PROJECT_ID,
} from "@/components/projectceo/mock";
import { ProjectCeoWorkspace } from "@/components/projectceo/project-workspace";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

export default async function ProjectCeoLocalQaPage({
  params,
}: {
  readonly params: Promise<{ readonly role: string }>;
}) {
  // This route is a sanitized, read-only browser harness. It is deterministic
  // in local development and structurally impossible to render in production.
  if (process.env.NODE_ENV === "production") notFound();
  const { role: roleParam } = await params;
  if (!PROJECTCEO_ROLES.includes(roleParam as ProjectCeoRole)) notFound();
  const role = roleParam as ProjectCeoRole;
  const result = await createProjectCeoMockPort(role).getProjectWorkspace({
    projectId: KORA_PROJECT_ID,
    requestId: crypto.randomUUID(),
  });
  if (!result.data || result.error) notFound();

  return (
    <main className="min-h-screen bg-paper px-4 py-5 sm:px-6">
      <nav className="mx-auto mb-4 flex max-w-7xl flex-wrap gap-2 rounded-2xl border border-line bg-white p-3">
        {PROJECTCEO_ROLES.map((candidate) => (
          <Link
            key={candidate}
            href={`/projectceo-qa/${candidate}`}
            className={candidate === role ? "btn-primary" : "btn-ghost"}
          >
            {ru.projectCeo.roles[candidate]}
          </Link>
        ))}
      </nav>
      <div className="mx-auto max-w-7xl">
        <ProjectCeoWorkspace view={result.data} />
      </div>
    </main>
  );
}
