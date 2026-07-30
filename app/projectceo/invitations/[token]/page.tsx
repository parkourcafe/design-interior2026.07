import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectCeoInvitationAccept } from "@/components/projectceo/invitation-accept";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Приглашение в проект — RemHaOS",
  robots: {
    index: false,
    follow: false,
  },
};

const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export default async function ProjectCeoInvitationPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) {
  const { token } = await params;
  if (!OPAQUE_TOKEN_PATTERN.test(token)) notFound();

  return <ProjectCeoInvitationAccept token={token} />;
}
