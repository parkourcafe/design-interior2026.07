"use client";

import { ru } from "@/lib/i18n/ru";
import type {
  AccessGrantView,
  InvitationView,
  OnboardingState,
} from "./contracts";
import { Badge } from "./badges";
import { CopyLinkButton } from "./copy-link-button";
import { ProjectCeoCommandButton } from "./command-client";
import { PROJECTCEO_COMMAND_CONTRACT_VERSION } from "@/lib/project-intelligence/delivery/projectceo/command-contract";

const projectCeoRu = ru.projectCeo;

function invitationTone(status: InvitationView["status"]) {
  if (status === "accepted") return "success" as const;
  if (status === "pending") return "warning" as const;
  return "danger" as const;
}

function invitationStatus(status: InvitationView["status"]): string {
  return projectCeoRu.onboarding.invitationStatus[status];
}

function grantStatus(status: AccessGrantView["status"]): string {
  return projectCeoRu.onboarding.grantStatus[status];
}

export function OnboardingPanel({
  projectId,
  onboarding,
  invitations,
  grants,
}: {
  readonly projectId: string | null;
  readonly onboarding: OnboardingState;
  readonly invitations: readonly InvitationView[];
  readonly grants: readonly AccessGrantView[];
}) {
  return (
    <section aria-labelledby="onboarding-title" className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{projectCeoRu.onboarding.eyebrow}</p>
          <h2 id="onboarding-title" className="mt-1 font-display text-2xl font-semibold">
            {projectCeoRu.onboarding.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {projectCeoRu.onboarding.lead}
          </p>
        </div>
        <Badge tone="success">{projectCeoRu.onboarding.noManualSupabase}</Badge>
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-4">
        {onboarding.steps.map((step, index) => (
          <li
            key={step.id}
            className={`rounded-xl border p-3 ${
              step.status === "complete"
                ? "border-emerald-200 bg-emerald-50/60"
                : step.status === "current"
                  ? "border-orange-200 bg-orange-50/60"
                  : "border-line bg-paper"
            }`}
          >
            <span className="text-[11px] text-muted">{projectCeoRu.onboarding.step(index + 1)}</span>
            <p className="mt-1 text-sm font-medium">{step.label}</p>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-xl border border-line bg-paper p-4">
          <h3 className="font-medium">{projectCeoRu.onboarding.newProjectScope}</h3>
          <fieldset className="mt-3" disabled>
            <legend className="text-xs text-muted">{projectCeoRu.onboarding.howToOpen}</legend>
            <div className="mt-2 grid gap-2">
              <label className="flex cursor-pointer gap-3 rounded-lg border border-line bg-white p-3">
                <input
                  type="radio"
                  name="scope-mode"
                  checked
                  readOnly
                />
                <span>
                  <span className="block text-sm font-medium">{projectCeoRu.common.fullProject}</span>
                  <span className="block text-xs text-muted">{projectCeoRu.onboarding.fullProjectHint}</span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-line bg-white p-3">
                <input
                  type="radio"
                  name="scope-mode"
                  checked={false}
                  readOnly
                />
                <span>
                  <span className="block text-sm font-medium">{projectCeoRu.common.exactWorkPackage}</span>
                  <span className="block text-xs text-muted">{projectCeoRu.onboarding.workPackageHint}</span>
                </span>
              </label>
            </div>
          </fieldset>
        </div>

        <form className="rounded-xl border border-line p-4">
          <h3 className="font-medium">{projectCeoRu.onboarding.inviteParticipant}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
            <label className="text-xs text-muted">
              {projectCeoRu.onboarding.recipientEmail}
              <input
                type="email"
                placeholder={projectCeoRu.onboarding.recipientPlaceholder}
                disabled
                className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>
            <label className="text-xs text-muted">
              {projectCeoRu.onboarding.role}
              <select
                defaultValue="architect"
                disabled
                className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="architect">{projectCeoRu.onboarding.architect}</option>
                <option value="builder">{projectCeoRu.onboarding.builder}</option>
                <option value="client">{projectCeoRu.onboarding.client}</option>
              </select>
            </label>
            <button type="button" disabled className="btn-primary">
              {projectCeoRu.actions.createLink}
            </button>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            {projectCeoRu.common.commandUnavailable}
          </p>
        </form>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">{projectCeoRu.onboarding.invitations}</h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="min-w-[680px] w-full text-left text-sm">
            <thead className="bg-paper text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{projectCeoRu.onboarding.recipient}</th>
                <th className="px-4 py-3 font-medium">{projectCeoRu.onboarding.role}</th>
                <th className="px-4 py-3 font-medium">{projectCeoRu.onboarding.scope}</th>
                <th className="px-4 py-3 font-medium">{projectCeoRu.onboarding.status}</th>
                <th className="px-4 py-3 font-medium">{projectCeoRu.onboarding.action}</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{invitation.recipientLabel}</td>
                  <td className="px-4 py-3">{projectCeoRu.roles[invitation.role]}</td>
                  <td className="px-4 py-3 text-muted">{invitation.scopeLabel}</td>
                  <td className="px-4 py-3">
                    <Badge tone={invitationTone(invitation.status)}>
                      {invitationStatus(invitation.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {invitation.shareUrl
                      ? <CopyLinkButton url={invitation.shareUrl} compact />
                      : <span className="text-xs text-muted">{projectCeoRu.common.unavailable}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">{projectCeoRu.onboarding.guestLinks}</h3>
        <div className="mt-2 grid gap-3">
          {grants.map((grant) => {
            const status = grant.status;
            return (
              <article key={grant.id} className="flex flex-col gap-3 rounded-xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{grant.label}</p>
                    <Badge tone={status === "active" ? "success" : "danger"}>{grantStatus(status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {projectCeoRu.onboarding.exactPackageReleaseUntil} {new Date(grant.expiresAt).toLocaleString(projectCeoRu.common.locale)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {grant.shareUrl && status === "active" && <CopyLinkButton url={grant.shareUrl} compact />}
                  {status === "active" && projectId && (
                    <ProjectCeoCommandButton
                      command={{
                        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                        kind: "revoke_guest_grant",
                        projectId,
                        payload: { grantId: grant.id },
                      }}
                      confirmation={projectCeoRu.onboarding.revokeConfirm(grant.label)}
                      className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      {projectCeoRu.actions.revoke}
                    </ProjectCeoCommandButton>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
