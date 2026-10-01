import { describe, expect, it } from "vitest";
import { validateSubmittedAnswers } from "./answer-schema";
import type { CustomBriefQuestion } from "./custom-questions";

const custom = [
  { type: "choice", title: "Цвет", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
  { type: "number", title: "Бюджет на свет, ₽" },
] as unknown as CustomBriefQuestion[];

function ok(raw: unknown, questions: CustomBriefQuestion[] = custom) {
  const result = validateSubmittedAnswers(raw, questions);
  if (!result.ok) throw new Error(`rejected: ${result.field}`);
  return result.answers;
}

// Ревью 28.09: настоящий клиент не должен получать отказ, из-за которого его
// черновик брифа больше никогда не отправится.
describe("validateSubmittedAnswers: normalizes what a real client can send", () => {
  it("drops empty reference slots the wizard writes by index", () => {
    expect(ok({ style: { refs: [null, "https://a.example", ""], anti: [null, "глянец"] } }).style)
      .toEqual({ refs: ["https://a.example"], anti: ["глянец"] });
  });

  it("trims over-long text instead of rejecting it", () => {
    const answers = ok({
      pain: "я".repeat(5000),
      style: { anti: ["x".repeat(300)], notes: "n".repeat(5000) },
      comments: { pain: "c".repeat(3000) },
    });
    expect((answers.pain as string).length).toBe(4000);
    expect((answers.style as { anti: string[] }).anti[0]?.length).toBe(200);
    expect((answers.comments as Record<string, string>).pain?.length).toBe(2000);
  });

  it("drops answers and comments for custom questions the designer removed or changed", () => {
    const answers = ok({
      custom_0: "c",            // вариант удалён
      custom_1: 2_500_000,      // крупная сумма в рублях — допустима
      custom_5: "x",            // вопроса больше нет
      comments: { custom_5: "устарело", custom_0: "ещё актуально" },
    });
    expect(answers).toEqual({ custom_1: 2_500_000, comments: { custom_0: "ещё актуально" } });
  });

  it("keeps only known options of a multi question and drops duplicates", () => {
    const multi = [{ type: "multi", title: "M", options: [{ value: "a", label: "A" }] }] as unknown as CustomBriefQuestion[];
    expect(ok({ custom_0: ["a", "a", "gone"] }, multi)).toEqual({ custom_0: ["a"] });
    expect(ok({ custom_0: ["gone"] }, multi)).toEqual({});
  });
});

describe("validateSubmittedAnswers: still refuses what the wizard never sends", () => {
  it.each([
    ["attachments", [{ path: "other/secret.pdf" }]],
    ["designer_plan_attachments", [{ path: "designer-plans/other/p.pdf" }]],
    ["custom_x", "x"],
    ["__proto__x", "x"],
  ])("rejects the key %s", (key, value) => {
    expect(validateSubmittedAnswers({ [key]: value }, custom)).toEqual({ ok: false, error: "invalid_answers", field: key });
  });

  it("rejects a wrong shape for a built-in question", () => {
    expect(validateSubmittedAnswers({ condition: "not-an-option" }, []).ok).toBe(false);
    expect(validateSubmittedAnswers({ object: { type: "flat", injected: true } }, []).ok).toBe(false);
    expect(validateSubmittedAnswers({ style: { refs: [{ path: "x" }] } }, []).ok).toBe(false);
  });

  it("reports consent only when the contact explicitly agrees", () => {
    const yes = validateSubmittedAnswers({ contact: { name: "A", phone: "1", consent: true } }, []);
    const no = validateSubmittedAnswers({ contact: { name: "A", phone: "1" } }, []);
    expect(yes.ok && yes.consent).toBe(true);
    expect(no.ok && no.consent).toBe(false);
  });
});
