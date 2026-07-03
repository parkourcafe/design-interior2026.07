import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { makeToken } from "@/lib/tokens";
import { appUrl } from "@/lib/env";
import { ru } from "@/lib/i18n/ru";
import type { Passport, PricingConfig, ProposalDefaults, ProposalSection } from "@/lib/types";
import { calcPrice, type PriceResult } from "@/lib/pricing/calc";
import { buildProposalSections } from "@/lib/proposal/build";
import type { RiskCardRow } from "@/lib/review";
import ProposalEditor from "./editor";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  client_name: string;
  status: string;
  passport: Passport | null;
}

export default async function ProposalPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, client_name, status, passport")
    .eq("id", params.id)
    .maybeSingle();
  if (!project) notFound();
  const p = project as ProjectRow;
  if (!p.passport) notFound();
  const passport = p.passport;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: designer } = await supabase
    .from("designers")
    .select("pricing, proposal_defaults")
    .eq("id", user!.id)
    .maybeSingle();
  const pricing = (designer?.pricing ?? null) as PricingConfig | null;
  const defaults = (designer?.proposal_defaults ?? {
    exclusions: [],
    revision_limit: 2,
    stage_completion: "",
  }) as ProposalDefaults;

  const { data: cardRows } = await supabase
    .from("risk_cards")
    .select("id, risk_type, evidence, impact, confidence, designer_action, proposal_implication, status, source")
    .eq("project_id", p.id)
    .eq("status", "accepted");
  const acceptedCards = (cardRows ?? []) as RiskCardRow[];

  // Цена: считаем, если есть pricing и площадь. Иначе — режим «без цены».
  const packageChoice = passport.scope.package ?? "full";
  let price: PriceResult | null = null;
  if (pricing && passport.object.area_m2) {
    price = calcPrice(pricing, {
      area_m2: passport.object.area_m2,
      complexity: "mid",
      urgent: passport.timeline.urgency === "urgent",
      package: packageChoice,
    });
  }

  // Обеспечить наличие черновика КП (public_token + событие proposal_created).
  const { data: existing } = await supabase
    .from("proposals")
    .select("id, sections, status, public_token")
    .eq("project_id", p.id)
    .eq("version", 1)
    .maybeSingle();

  let sections: ProposalSection[];
  let publicToken: string;
  let sent = false;

  if (existing && Array.isArray(existing.sections) && (existing.sections as ProposalSection[]).length > 0) {
    sections = existing.sections as ProposalSection[];
    publicToken = existing.public_token as string;
    sent = existing.status === "sent";
  } else {
    sections = buildProposalSections({ passport, acceptedCards, defaults, price, packageChoice });
    if (existing) {
      publicToken = existing.public_token as string;
      await supabase.from("proposals").update({ sections }).eq("id", existing.id);
    } else {
      publicToken = makeToken();
      await supabase.from("proposals").insert({
        project_id: p.id,
        version: 1,
        sections,
        status: "draft",
        public_token: publicToken,
      });
      await supabase.from("projects").update({ status: "proposal_draft" }).eq("id", p.id);
      await supabase.from("events").insert({
        designer_id: user!.id,
        project_id: p.id,
        type: "proposal_created",
      });
    }
  }

  const publicUrl = `${appUrl()}/p/${publicToken}`;

  return (
    <div>
      <div className="mb-6">
        <Link href={`/dashboard/projects/${p.id}`} className="text-sm text-muted hover:text-ink">
          ← {ru.review.title}
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold">{ru.proposal.draftTitle}</h1>
        <p className="mt-1 text-sm text-muted">{ru.proposal.editHint}</p>
        {!pricing && <p className="mt-1 text-sm text-amber-800">{ru.proposal.noPrice}</p>}
      </div>

      <ProposalEditor
        projectId={p.id}
        initialSections={sections}
        publicUrl={publicUrl}
        alreadySent={sent}
      />
    </div>
  );
}
