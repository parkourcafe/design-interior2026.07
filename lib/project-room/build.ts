import type { ProposalSection, ScopePackage } from "@/lib/types";
import type { TaskSeed } from "./types";

const DAY = 86_400_000;
const isoDate = (start: Date, days: number) => new Date(start.getTime() + days * DAY).toISOString().slice(0, 10);

export function buildInitialTasks(input: {
  start: Date;
  packageChoice: Exclude<ScopePackage, null>;
  sections: ProposalSection[];
  acceptedRisks: { id: string; impact: string; proposal_implication: string }[];
}): TaskSeed[] {
  const stageSection = input.sections.find((section) => section.id === "stages")?.id ?? null;
  const scopeSection =
    input.sections.find((section) => section.id === "package")?.id ??
    input.sections.find((section) => section.id === "works")?.id ??
    input.sections.find((section) => section.id === "included")?.id ??
    null;
  const packageDays = input.packageChoice === "concept" ? 21 : input.packageChoice === "full" ? 45 : 60;
  const tasks: TaskSeed[] = [
    { title: "Подтвердить старт проекта", description: "Согласовать дату старта и основные контакты.", owner_role: "client", due_date: isoDate(input.start, 3), client_facing: true, related_scope_item: "kickoff", proposal_section: stageSection, created_from: "proposal", sort_order: 10 },
    { title: "Провести установочную встречу", description: "Зафиксировать договорённости по составу работ и этапам.", owner_role: "designer", due_date: isoDate(input.start, 7), client_facing: true, related_scope_item: "kickoff", proposal_section: scopeSection, created_from: "proposal", sort_order: 20 },
    { title: "Подготовить материалы этапа", description: "Выполнить ближайший этап принятого состава работ.", owner_role: "designer", due_date: isoDate(input.start, packageDays), client_facing: true, related_scope_item: input.packageChoice, proposal_section: stageSection, created_from: "proposal", sort_order: 30 },
    { title: "Передать задание исполнителю", description: "Передать исполнителю только утверждённые материалы и сроки.", owner_role: "executor", due_date: isoDate(input.start, packageDays + 7), client_facing: false, related_scope_item: "executor_handoff", proposal_section: stageSection, created_from: "system", sort_order: 40 },
  ];

  input.acceptedRisks.slice(0, 3).forEach((risk, index) => tasks.push({
    title: `Согласовать принятый риск ${index + 1}`,
    description: risk.proposal_implication || risk.impact,
    owner_role: "designer",
    due_date: isoDate(input.start, 10 + index),
    client_facing: true,
    related_scope_item: risk.id,
    proposal_section: null,
    created_from: "accepted_risk",
    sort_order: 50 + index,
  }));
  return tasks;
}
