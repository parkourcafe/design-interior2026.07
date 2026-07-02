import { createClient } from "@/lib/supabase/server";
import type { PricingConfig, ProposalDefaults } from "@/lib/types";
import SetupForm from "./form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: designer } = await supabase
    .from("designers")
    .select("name, studio_name, pricing, proposal_defaults")
    .eq("id", user!.id)
    .maybeSingle();

  return (
    <SetupForm
      initial={{
        name: designer?.name ?? "",
        studio_name: designer?.studio_name ?? "",
        pricing: (designer?.pricing ?? null) as PricingConfig | null,
        proposal_defaults: (designer?.proposal_defaults ?? {
          exclusions: [],
          revision_limit: 2,
          stage_completion: "",
        }) as ProposalDefaults,
      }}
    />
  );
}
