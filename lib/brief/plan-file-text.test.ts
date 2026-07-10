import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { derivePlanAssistedDraft } from "./plan-assist";
import { extractPdfTextFromBuffer, extractPlanFileText, yandexVisionOcr } from "./plan-file-text";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function pdfWithStream(stream: Buffer, flate = false): Buffer {
  const dict = flate
    ? `<< /Length ${stream.length} /Filter /FlateDecode >>`
    : `<< /Length ${stream.length} >>`;
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n${dict}\nstream\n`, "latin1"),
    stream,
    Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
  ]);
}

describe("plan file text extraction", () => {
  it("extracts plain text files", async () => {
    const file = new File(["Outdoor kitchen 25 m2, ventilation and CCTV."], "notes.txt", {
      type: "text/plain",
    });

    const result = await extractPlanFileText(file);

    expect(result.status).toBe("text_extracted");
    expect(result.source).toBe("plain_text");
    expect(result.excerpt).toContain("Outdoor kitchen");
  });

  it("extracts simple PDF text operators from Flate streams", () => {
    const stream = deflateSync(Buffer.from("BT (Outdoor kitchen 25 m2) Tj ( ventilation CCTV) Tj ET", "latin1"));
    const text = extractPdfTextFromBuffer(pdfWithStream(stream, true));

    expect(text).toContain("Outdoor kitchen 25 m2");
    expect(text).toContain("ventilation CCTV");
  });

  it("decodes simple PDF ToUnicode maps", () => {
    const cmap = Buffer.from(
      [
        "/CIDInit /ProcSet findresource begin",
        "11 beginbfchar",
        "<33> <0050>",
        "<35> <0052>",
        "<32> <004F>",
        "<2D> <004A>",
        "<28> <0045>",
        "<26> <0043>",
        "<37> <0054>",
        "<20> <0020>",
        "<31> <004E>",
        "<24> <0041>",
        "<30> <004D>",
        "endbfchar",
        "end",
      ].join("\n"),
      "latin1",
    );
    const content = Buffer.from("BT (352-\\(&7 1$0\\() Tj ET", "latin1");
    const pdf = Buffer.concat([pdfWithStream(deflateSync(cmap), true), pdfWithStream(deflateSync(content), true)]);

    expect(extractPdfTextFromBuffer(pdf)).toContain("PROJECT NAME");
  });

  it("uses extracted file text as plan-assist evidence", () => {
    const draft = derivePlanAssistedDraft({
      project_type: "residential",
      description: "Дом",
      plan_files: [
        {
          name: "plan.pdf",
          type: "application/pdf",
          text_excerpt: "Plan 15 x 16.6 m. Outdoor kitchen, bedroom, bathroom, ventilation.",
          text_extraction: { status: "text_extracted", source: "pdf_text", chars: 66 },
        },
      ],
    });

    const values = draft.facts.map((fact) => fact.value).join(" ");
    const evidence = draft.facts.map((fact) => fact.evidence).join(" ");
    expect(values).toContain("15 x 16.6 м");
    expect(values).toContain("летняя кухня");
    expect(values).toContain("вентиляция");
    expect(evidence).toContain("Текст файла");
  });

  it("runs OCR for images through an injected client", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "plan.png", { type: "image/png" });

    const result = await extractPlanFileText(file, {
      ocrClient: async () => ({
        status: "text_extracted",
        source: "vision_ocr",
        chars: 44,
        excerpt: "План участка 15 x 16.6 м, летняя кухня",
      }),
    });

    expect(result).toMatchObject({
      status: "text_extracted",
      source: "vision_ocr",
    });
    expect(result.excerpt).toContain("летняя кухня");
  });

  it("sends OCR requests to Yandex Vision OCR", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ textAnnotation: { fullText: "Летняя кухня 25 м2" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;
    const file = new File(["fake-image"], "plan.png", { type: "image/png" });

    const result = await yandexVisionOcr(file, {
      folderId: "folder",
      apiKey: "api-key",
      model: "page",
      languageCodes: ["ru", "en"],
    });

    expect(result).toMatchObject({
      status: "text_extracted",
      source: "vision_ocr",
    });
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Api-Key api-key");
    const body = JSON.parse(String(init?.body)) as { mimeType: string; model: string; languageCodes: string[] };
    expect(body).toMatchObject({
      mimeType: "image/png",
      model: "page",
      languageCodes: ["ru", "en"],
    });
  });
});
