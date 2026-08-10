import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { forkLayoutDocument } from "@/lib/layout-studio/domain/fork-variant";
import {
  canonicalSerialize,
  semanticHash,
  validateLayoutDocument,
} from "@/lib/layout-studio/domain";
import koraFixture from "@/fixtures/layout-studio/kora-liquid-station.v0.2.json";
import type { LayoutDocument } from "@/lib/layout-studio/domain";

import { makeSimpleRoom } from "../application/layout-test-fixture";

const SPEC = {
  documentId: "layout.20000000-0000-4000-8000-00000000000f",
  variantLabel: "Экономичный (value engineered)",
} as const;

describe("forkLayoutDocument: копия планировки под новый вариант", () => {
  it("меняет ровно идентичность: документ, вариант, ревизию, провенанс", () => {
    const source = makeSimpleRoom();
    const fork = forkLayoutDocument(source, SPEC);

    expect(fork.documentId).toBe(SPEC.documentId);
    expect(fork.variant.id).toBe(`variant.${SPEC.documentId}.a`);
    expect(fork.variant.label).toBe(SPEC.variantLabel);
    expect(fork.variant.status).toBe("draft");
    expect(fork.stateRevision).toBe(0);
    expect(fork.metadata.sourceRefs).toContain(
      `forked-from://layout/${source.documentId}`,
    );

    // Всё остальное — байт в байт: вернув идентичность, получаем источник.
    const reverted = structuredClone(fork);
    (reverted as { documentId: string }).documentId = source.documentId;
    reverted.variant = structuredClone(source.variant);
    (reverted as { stateRevision: number }).stateRevision = source.stateRevision;
    reverted.metadata = structuredClone(source.metadata);
    expect(canonicalSerialize(reverted)).toBe(canonicalSerialize(source));
  });

  it("источник не мутируется, а копия валидна по замороженной схеме", async () => {
    const source = makeSimpleRoom();
    const before = canonicalSerialize(source);
    const fork = forkLayoutDocument(source, SPEC);

    expect(canonicalSerialize(source)).toBe(before);
    expect(validateLayoutDocument(fork).valid).toBe(true);
    // Разная идентичность — разные подписи: копию нельзя выдать за оригинал.
    await expect(semanticHash(fork)).resolves.not.toBe(await semanticHash(source));
  });

  it("предупреждения источника переезжают в копию: она не достовернее оригинала", () => {
    const source = koraFixture as unknown as LayoutDocument;
    const fork = forkLayoutDocument(source, SPEC);
    expect(fork.metadata.warnings).toEqual(source.metadata.warnings);
    expect(validateLayoutDocument(fork).valid).toBe(true);
  });
});

describe("кнопка варианта на странице редактора", () => {
  it("страница монтирует форму, действие переносит привязку атомарно", () => {
    const page = readFileSync(
      join(process.cwd(), "app/dashboard/projects/[id]/layouts/[documentId]/page.tsx"),
      "utf8",
    );
    expect(page).toContain("ForkVariantForm");

    const actions = readFileSync(
      join(process.cwd(), "app/dashboard/projects/[id]/layouts/actions.ts"),
      "utf8",
    );
    // Привязка уходит тем же createDocument, а не вторым запросом после.
    expect(actions).toContain("forkLayoutDocument");
    expect(actions).toMatch(/createDocument\(\s*projectId,\s*fork,\s*title,\s*sourceBinding/);
  });
});
