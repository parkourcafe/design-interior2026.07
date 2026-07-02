import { notFound } from "next/navigation";
import { getProjectByIntakeToken } from "@/lib/intake";
import { appUrl } from "@/lib/env";
import { ru } from "@/lib/i18n/ru";
import ShareBrief from "@/components/share-brief";
import IntakeWizard from "./wizard";

export const dynamic = "force-dynamic";

export default async function IntakePage({ params }: { params: { token: string } }) {
  const project = await getProjectByIntakeToken(params.token);
  if (!project) notFound();

  const selfServe = !project.designer_id;
  const completed = ["brief_completed", "proposal_draft", "proposal_sent"].includes(project.status);

  if (completed) {
    // Клиентский бриф → показываем ссылку для рассылки дизайнерам.
    if (selfServe) {
      return (
        <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 text-center">
          <h1 className="text-2xl font-semibold">{ru.client.shareTitle}</h1>
          <p className="mt-2 text-muted">{ru.client.shareHint}</p>
          <ShareBrief url={`${appUrl()}/b/${params.token}`} />
        </main>
      );
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">{ru.brief.done.title}</h1>
        <p className="mt-2 text-muted">{ru.brief.done.subtitle}</p>
      </main>
    );
  }

  return <IntakeWizard token={params.token} selfServe={selfServe} />;
}
