"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ProjectCeoCommand,
  ProjectCeoCommandDraft,
  ProjectCeoCommandResponse,
} from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { ru } from "@/lib/i18n/ru";

export async function sendProjectCeoCommand(
  command: ProjectCeoCommand | ProjectCeoCommandDraft,
  commandId = crypto.randomUUID(),
): Promise<ProjectCeoCommandResponse> {
  const request = "commandId" in command ? command : { ...command, commandId };
  const response = await fetch("/api/projectceo/commands", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return response.json() as Promise<ProjectCeoCommandResponse>;
}

export function ProjectCeoCommandButton({
  command,
  children,
  disabled = false,
  className = "btn-primary",
  confirmation,
}: {
  readonly command: ProjectCeoCommandDraft;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly confirmation?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const fingerprint = JSON.stringify(command);
  const commandIdentity = useRef({ fingerprint, commandId: crypto.randomUUID() });
  useEffect(() => {
    commandIdentity.current = { fingerprint, commandId: crypto.randomUUID() };
  }, [fingerprint]);

  async function run(): Promise<void> {
    if (disabled || state === "pending") return;
    if (confirmation && !window.confirm(confirmation)) return;
    setState("pending");
    try {
      const response = await sendProjectCeoCommand(
        command,
        commandIdentity.current.commandId,
      );
      if (response.status !== "completed") {
        setState("error");
        return;
      }
      commandIdentity.current = { fingerprint, commandId: crypto.randomUUID() };
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        disabled={disabled || state === "pending"}
        className={className}
      >
        {state === "pending" ? ru.projectCeo.actions.refresh : children}
      </button>
      {state === "error" && (
        <span role="status" className="text-[11px] text-red-700">
          {ru.projectCeo.common.commandUnavailable}
        </span>
      )}
    </span>
  );
}
