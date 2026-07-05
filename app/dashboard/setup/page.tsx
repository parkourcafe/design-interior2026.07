import { redirect } from "next/navigation";
import type { PricingConfig, ProposalDefaults, DesignerProfile } from "@/lib/types";
import { getStudio, listStudioMembers } from "@/lib/studio";
import { ru } from "@/lib/i18n/ru";
import DesignerCard from "@/components/designer-card";
import SetupForm from "./form";
import SetPassword from "./set-password";
import TeamMembers from "./team";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const studio = await getStudio();
  if (!studio) redirect("/login");

  const designer = studio.designer;
  const members = await listStudioMembers(studio.studioId);

  return (
    <>
      <section className="mb-6">
        <h2 className="mb-2 font-display text-xl font-semibold">{ru.profilePreview.title}</h2>
        <p className="mb-3 text-sm text-muted">{ru.profilePreview.hint}</p>
        <DesignerCard
          designer={{
            name: designer.name ?? "",
            studio_name: designer.studio_name ?? "",
            email: studio.email,
            profile: (designer.profile ?? {}) as DesignerProfile,
          }}
        />
      </section>
      <SetupForm
        initial={{
          name: designer.name ?? "",
          studio_name: designer.studio_name ?? "",
          pricing: (designer.pricing ?? null) as PricingConfig | null,
          proposal_defaults: (designer.proposal_defaults ?? {
            exclusions: [],
            revision_limit: 2,
            stage_completion: "",
          }) as ProposalDefaults,
          profile: (designer.profile ?? {}) as DesignerProfile,
        }}
      />
      <TeamMembers members={members} role={studio.role} currentEmail={studio.email} />
      <SetPassword email={studio.email} />
    </>
  );
}
