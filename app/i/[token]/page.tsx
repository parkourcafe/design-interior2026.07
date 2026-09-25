import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProjectByIntakeToken } from "@/lib/intake";
import { getDesignerPublic, type DesignerPublic } from "@/lib/designer";
import { ru } from "@/lib/i18n/ru";
import { isIntakeOpen } from "@/lib/intake-status";
import IntakeWizard from "./wizard";

export const dynamic = "force-dynamic";

// Клиентский бриф по ссылке — ПДн, вне индекса (сверх X-Robots-Tag/robots.txt).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const project = await getProjectByIntakeToken(token);
  if (!project) notFound();

  const selfServe = !project.designer_id;
  const designer: DesignerPublic | null = project.designer_id
    ? await getDesignerPublic(project.designer_id)
    : null;
  // Любой статус после заполнения брифа — экран «готово», не визард.
  const completed = !isIntakeOpen(project.status);

  if (completed) {
    // Клиентский бриф: ссылка для рассылки дизайнерам закрыта (DEC-040) до
    // безопасного подтверждения личности — показываем только подтверждение.
    if (selfServe) {
      return (
        <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 text-center">
          <h1 className="text-2xl font-semibold">{ru.client.shareTitle}</h1>
          <p className="mt-2 text-muted">{ru.client.shareHint}</p>
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

  return (
    <IntakeWizard
      token={token}
      selfServe={selfServe}
      customQuestions={project.custom_questions}
      designer={designer}
    />
  );
}
