import { notFound } from "next/navigation";
import { getProjectByIntakeToken } from "@/lib/intake";
import { ru } from "@/lib/i18n/ru";
import IntakeWizard from "./wizard";

export const dynamic = "force-dynamic";

export default async function IntakePage({ params }: { params: { token: string } }) {
  const project = await getProjectByIntakeToken(params.token);
  if (!project) notFound();

  if (project.status === "brief_completed" || project.status === "proposal_draft" || project.status === "proposal_sent") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">{ru.brief.done.title}</h1>
        <p className="mt-2 text-muted">{ru.brief.done.subtitle}</p>
      </main>
    );
  }

  return <IntakeWizard token={params.token} />;
}
