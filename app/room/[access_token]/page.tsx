import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { ru } from "@/lib/i18n/ru";
import { canSeeTask } from "@/lib/project-room/access";
import { isRoomClosed, type RoomClosureClient } from "@/lib/project-room/closed";
import type { ParticipantRole, ProjectTask } from "@/lib/project-room/types";
import PublicTaskControls from "./task-controls";
import KitReceipt from "./kit-receipt";
import PassportView from "@/components/passport-view";
import { snapshotMatches, type ManifestEntry } from "@/lib/project-room/handover";
import type { Passport, ProposalSection } from "@/lib/types";

export const dynamic = "force-dynamic";

// Участник Project Room по токену — задачи проекта, вне индекса
// (сверх X-Robots-Tag/robots.txt).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ParticipantRoomPage({ params }: { params: Promise<{ access_token: string }> }) {
  const { access_token } = await params;
  const admin = createScopedServiceClient("participant-room");
  const { data: participant } = await admin.from("project_participants").select("id, room_id, role, display_name").eq("access_token", access_token).maybeSingle();
  if (!participant) notFound();
  const p = participant as { id: string; room_id: string; role: ParticipantRole; display_name: string };
  // DEC-047 (g): студия запросила удаление аккаунта — комната закрыта сразу.
  if (await isRoomClosed(admin as unknown as RoomClosureClient, p.room_id)) {
    return <main className="mx-auto max-w-2xl px-6 py-16"><div className="card space-y-2"><h1 className="font-display text-2xl font-semibold">{ru.projectRoom.closedTitle}</h1><p className="text-sm text-muted">{ru.projectRoom.closedBody}</p></div></main>;
  }
  const { data: taskRows } = await admin.from("project_tasks").select("id, title, description, owner_role, assignee_participant_id, due_date, status, client_facing, related_scope_item, proposal_section, created_from, sort_order").eq("room_id", p.room_id).order("sort_order");
  const tasks = ((taskRows ?? []) as ProjectTask[]).filter((task) => canSeeTask(p.role, p.id, task));
  const kit = p.role === "executor" ? await loadKit(admin, p.room_id, p.id) : null;
  return <main className="mx-auto max-w-3xl px-6 py-10"><header className="mb-7"><p className="text-xs uppercase tracking-widest text-muted">{ru.projectRoom.title}</p><h1 className="font-display text-3xl font-semibold">{p.display_name}</h1><p className="text-sm text-muted">{ru.projectRoom.roleView}: {ru.projectRoom.roles[p.role]}</p></header>{kit ? <KitSection kit={kit} token={access_token} /> : null}<div className="space-y-3">{tasks.map((task) => <article className="card" key={task.id}><div className="flex items-start justify-between gap-3"><div><h2 className="font-medium">{task.title}</h2><p className="mt-1 text-sm text-muted">{task.description}</p><p className="mt-2 text-xs text-muted">{ru.projectRoom.due}: {task.due_date ?? "—"}</p></div><span className="rounded-full bg-line/50 px-2 py-1 text-xs">{ru.projectRoom.status[task.status]}</span></div>{task.owner_role === p.role && task.assignee_participant_id === p.id && <PublicTaskControls token={access_token} taskId={task.id} value={task.status} />}</article>)}</div></main>;
}

type ServiceClient = ReturnType<typeof createScopedServiceClient>;

interface LoadedKit {
  readonly proposalVersion: number;
  readonly sections: ProposalSection[];
  readonly passport: Passport;
  readonly manifest: ManifestEntry[];
  readonly links: Record<string, string>;
  readonly intact: boolean;
  readonly receivedAt: string | null;
}

// Комплект исполнителя (решение владельца 01.10.2026): только то, что в manifest;
// ссылки на файлы — подписанные, на 15 минут; снимки сверяются с хешами manifest.
async function loadKit(admin: ServiceClient, roomId: string, participantId: string): Promise<LoadedKit | null> {
  const { data } = await admin.from("project_handover_kits")
    .select("id, proposal_version, proposal_sections, passport_summary, manifest")
    .eq("room_id", roomId).maybeSingle();
  if (!data) return null;
  const kit = data as { id: string; proposal_version: number; proposal_sections: ProposalSection[]; passport_summary: Passport; manifest: ManifestEntry[] };
  const manifest = Array.isArray(kit.manifest) ? kit.manifest : [];
  const links: Record<string, string> = {};
  for (const entry of manifest) {
    if (!entry.bucket || !entry.path) continue;
    const { data: signed } = await admin.storage.from(entry.bucket).createSignedUrl(entry.path, 900, { download: entry.name });
    if (signed?.signedUrl) links[entry.path] = signed.signedUrl;
  }
  const intact = snapshotMatches(manifest.find((e) => e.kind === "proposal"), kit.proposal_sections)
    && snapshotMatches(manifest.find((e) => e.kind === "passport_summary"), kit.passport_summary);
  const { data: receipt } = await admin.from("project_handover_receipts").select("received_at")
    .eq("kit_id", kit.id).eq("participant_id", participantId).maybeSingle();
  return {
    proposalVersion: kit.proposal_version,
    sections: kit.proposal_sections,
    passport: kit.passport_summary,
    manifest,
    links,
    intact,
    receivedAt: (receipt as { received_at?: string } | null)?.received_at ?? null,
  };
}

function KitSection({ kit, token }: { kit: LoadedKit; token: string }) {
  const h = ru.handover;
  return (
    <section className="mb-8 space-y-4">
      <div className="card border-accent/30">
        <h2 className="font-display text-2xl font-semibold">{h.kitTitle}</h2>
        <p className="mt-1 text-sm text-muted">{h.kitLead}</p>
        {!kit.intact ? <p role="alert" className="mt-2 text-sm text-red-700">{h.integrityError}</p> : null}
        <div className="mt-4"><KitReceipt token={token} initialReceivedAt={kit.receivedAt} /></div>
      </div>
      <details className="card" open>
        <summary className="cursor-pointer font-medium">{h.kitProposal(kit.proposalVersion)}</summary>
        <div className="mt-3 space-y-4">
          {kit.sections.map((section) => (
            <div key={section.id}>
              <h3 className="font-medium">{section.title}</h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink/90">{section.body}</p>
            </div>
          ))}
        </div>
      </details>
      <div>
        <h3 className="mb-2 font-medium">{h.kitPassport}</h3>
        <PassportView passport={kit.passport} audience="contractor" />
      </div>
      <div className="card">
        <h3 className="font-medium">{h.kitManifest}</h3>
        <p className="mt-1 text-xs text-muted">{h.kitManifestHint}</p>
        <ul className="mt-3 space-y-2 text-sm">
          {kit.manifest.map((entry) => (
            <li key={`${entry.kind}:${entry.path ?? entry.name}`} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
              <span>
                <span className="text-xs uppercase text-muted">{h.fileKind[entry.kind] ?? entry.kind}</span>{" "}
                {entry.name}
                <span className="block font-mono text-xs text-muted">sha256 {entry.sha256} · {entry.size} B</span>
              </span>
              {entry.path && kit.links[entry.path] ? (
                <a className="btn-ghost text-xs" href={kit.links[entry.path]} rel="noopener noreferrer">{h.download}</a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
