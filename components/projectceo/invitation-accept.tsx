"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { PROJECTCEO_INVITATION_ACCEPT_CONTRACT_VERSION } from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { projectCeoInvitationLoginHref } from "@/lib/project-intelligence/delivery/projectceo/invitation-login";

type InvitationState = "idle" | "pending" | "completed" | "unauthenticated" | "error";

export function ProjectCeoInvitationAccept({ token }: { readonly token: string }) {
  const router = useRouter();
  const [state, setState] = useState<InvitationState>("idle");
  const submitting = useRef(false);
  const copy = ru.projectCeo.invitationAccept;

  async function accept(): Promise<void> {
    if (submitting.current || state === "completed") return;
    submitting.current = true;
    setState("pending");
    try {
      const response = await fetch("/api/projectceo/invitations/accept", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractVersion: PROJECTCEO_INVITATION_ACCEPT_CONTRACT_VERSION,
          token,
        }),
      });
      const payload = await response.json() as {
        readonly status?: string;
        readonly error?: { readonly code?: string };
      };
      if (response.status === 401 || payload.error?.code === "unauthenticated") {
        setState("unauthenticated");
        return;
      }
      if (!response.ok || payload.status !== "completed") {
        setState("error");
        return;
      }
      setState("completed");
      router.refresh();
    } catch {
      setState("error");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <section className="rounded-3xl border border-line bg-white p-6 shadow-xl sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          {copy.eyebrow}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{copy.lead}</p>

        {state === "completed" ? (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-800">{copy.completed}</p>
            <Link href="/dashboard/projectceo" className="btn-primary mt-4 inline-flex">
              {copy.openProject}
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={accept}
            disabled={state === "pending"}
            className="btn-primary mt-6 w-full"
          >
            {state === "pending" ? copy.pending : copy.accept}
          </button>
        )}

        {state === "unauthenticated" && (
          <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm">
            <p>{copy.signInRequired}</p>
            <Link href={projectCeoInvitationLoginHref(token)} className="mt-2 inline-flex font-medium text-accent hover:underline">
              {copy.signIn}
            </Link>
          </div>
        )}
        {state === "error" && (
          <p role="status" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {copy.error}
          </p>
        )}
      </section>
    </main>
  );
}
