import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  pickLayoutPlanSvg,
  svgToDataUri,
} from "@/lib/layout-studio/adapters/http/layout-plan-source";

import { makeSimpleRoom } from "../application/layout-test-fixture";

/**
 * §8.4: клиент выбирает вариант по чертежу. Логика выбора и отрисовки — чистая
 * функция; здесь же статический замок на то, что витрина согласования
 * действительно монтирует миниатюру (иначе она молча исчезнет при следующей
 * правке панели).
 */

const REVISION = "50000000-0000-4000-8000-000000000001";

function makeRow(revisionId: string, layoutContent: unknown): unknown {
  return { revisionId, payload: { layoutContent } };
}

describe("pickLayoutPlanSvg: чертёж версии для витрины", () => {
  it("находит строку по ревизии и собирает SVG плана", () => {
    const svg = pickLayoutPlanSvg([makeRow(REVISION, makeSimpleRoom())], REVISION);
    expect(svg).toBeTruthy();
    expect(svg).toContain("<svg");
    // data-URI не тащит сырую разметку в DOM витрины.
    expect(svgToDataUri(svg!)).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it("чужая ревизия, мусорное содержимое и не-массив дают null, а не исключение", () => {
    expect(pickLayoutPlanSvg([makeRow(REVISION, makeSimpleRoom())], "другая")).toBeNull();
    expect(pickLayoutPlanSvg([makeRow(REVISION, { hello: "world" })], REVISION)).toBeNull();
    expect(pickLayoutPlanSvg([makeRow(REVISION, null)], REVISION)).toBeNull();
    expect(pickLayoutPlanSvg("не массив", REVISION)).toBeNull();
    expect(pickLayoutPlanSvg(undefined, REVISION)).toBeNull();
  });
});

describe("витрина согласования монтирует чертёж", () => {
  it("панель клиентского ревью рендерит LayoutPlanThumbnail по layoutRevisionId", () => {
    const source = readFileSync(
      join(process.cwd(), "components/projectceo/m2-client-review-panel.tsx"),
      "utf8",
    );
    expect(source).toContain("LayoutPlanThumbnail");
    expect(source).toContain("layoutRevisionId={variant.layoutRevisionId}");
  });

  it("миниатюра вставляет план через data-URI, а не сырой разметкой", () => {
    const source = readFileSync(
      join(process.cwd(), "components/layout-studio/plan-thumbnail.tsx"),
      "utf8",
    );
    expect(source).toContain("svgToDataUri");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
