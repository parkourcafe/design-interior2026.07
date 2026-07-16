"use client";

import { useState } from "react";
import { ru } from "@/lib/i18n/ru";

const projectCeoRu = ru.projectCeo;

export function CopyLinkButton({
  url,
  compact = false,
}: {
  readonly url: string;
  readonly compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={compact ? "rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent" : "btn-ghost"}
      aria-label={`${projectCeoRu.actions.copy}: ${projectCeoRu.common.safeLinkAria}`}
    >
      {copied ? projectCeoRu.actions.copied : projectCeoRu.actions.copy}
    </button>
  );
}
