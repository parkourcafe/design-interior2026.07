import type { Metadata } from "next";
import IntakeWithdrawal from "./withdrawal";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function IntakeConsentManagement({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Receipt possession is independent of the project's continued existence.
  return <IntakeWithdrawal token={token} />;
}
