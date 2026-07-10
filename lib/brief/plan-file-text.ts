import { inflateSync } from "node:zlib";

export type PlanTextExtractionStatus = "text_extracted" | "no_text" | "unsupported" | "failed";
export type PlanTextExtractionSource = "pdf_text" | "plain_text" | "vision_ocr" | "none";

export interface PlanTextExtraction {
  status: PlanTextExtractionStatus;
  source: PlanTextExtractionSource;
  chars: number;
  excerpt?: string;
  message?: string;
}

const EXCERPT_LIMIT = 3000;
const MAX_TEXT_BYTES = 15 * 1024 * 1024;
const MAX_STREAM_TEXT_BYTES = 1_500_000;
const YANDEX_OCR_URL = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText";
type ToUnicodeMap = Map<string, string>;

export interface PlanOcrOptions {
  folderId?: string;
  apiKey?: string;
  model?: string;
  languageCodes?: string[];
}

export type PlanOcrClient = (file: File, options?: PlanOcrOptions) => Promise<PlanTextExtraction>;

export interface PlanTextExtractionOptions {
  ocrClient?: PlanOcrClient | null;
  ocr?: PlanOcrOptions;
}

function cleanExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeHumanText(value: string): boolean {
  const clean = cleanExtractedText(value);
  if (clean.length < 12) return false;
  const tokens = clean.split(/\s+/).filter(Boolean);
  const shortTokens = tokens.filter((token) => token.length === 1).length;
  if (tokens.length > 40 && shortTokens / tokens.length > 0.55) return false;
  const useful = clean.match(/[\p{L}\p{N}\s.,:;!?/()+\-№"«»]/gu)?.length ?? 0;
  return useful / clean.length > 0.75;
}

function decodeUtf16Be(bytes: Buffer): string {
  const codeUnits: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    codeUnits.push((bytes[i]! << 8) | bytes[i + 1]!);
  }
  return String.fromCharCode(...codeUnits);
}

function hexKey(raw: string): string {
  const clean = raw.replace(/\s+/g, "").toUpperCase();
  return clean.length % 2 === 0 ? clean : `0${clean}`;
}

function decodeHexString(raw: string): string {
  const hex = hexKey(raw);
  if (!hex || hex.length < 2) return "";
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes.every((_, index) => index % 2 === 1 || bytes[index] === 0)) {
    return decodeUtf16Be(bytes);
  }
  return bytes.toString("utf8");
}

function literalBytes(raw: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0) & 0xff);
      continue;
    }
    const next = raw[i + 1];
    if (!next) break;
    i += 1;
    switch (next) {
      case "n":
        bytes.push(0x0a);
        break;
      case "r":
        bytes.push(0x0d);
        break;
      case "t":
        bytes.push(0x09);
        break;
      case "b":
      case "f":
        bytes.push(0x20);
        break;
      case "\n":
      case "\r":
        break;
      case "(":
      case ")":
      case "\\":
        bytes.push(next.charCodeAt(0) & 0xff);
        break;
      default:
        if (/[0-7]/.test(next)) {
          const octal = [next, raw[i + 1], raw[i + 2]].filter((item) => item && /[0-7]/.test(item)).join("");
          i += octal.length - 1;
          bytes.push(Number.parseInt(octal, 8) & 0xff);
        } else {
          bytes.push(next.charCodeAt(0) & 0xff);
        }
    }
  }
  return Buffer.from(bytes);
}

function decodeLiteralString(raw: string): string {
  return literalBytes(raw).toString("latin1");
}

function literalPattern(): RegExp {
  return /\(((?:\\.|[^\\()])*)\)/g;
}

function incrementHexUnicode(hex: string, offset: number): string {
  const bytes = Buffer.from(hexKey(hex), "hex");
  if (bytes.length < 2) return decodeHexString(hex);
  const codeUnits: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    codeUnits.push((bytes[i]! << 8) | bytes[i + 1]!);
  }
  const last = codeUnits.length - 1;
  codeUnits[last] = (codeUnits[last] ?? 0) + offset;
  return String.fromCharCode(...codeUnits);
}

function parseToUnicodeMaps(streams: Buffer[]): ToUnicodeMap[] {
  const maps: ToUnicodeMap[] = [];
  for (const stream of streams) {
    const content = stream.toString("latin1");
    if (!/beginbfchar|beginbfrange/.test(content)) continue;
    const map: ToUnicodeMap = new Map();

    for (const block of content.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const entry of (block[1] ?? "").matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>/g)) {
        if (entry[1] && entry[2]) map.set(hexKey(entry[1]), decodeHexString(entry[2]));
      }
    }

    for (const block of content.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const body = block[1] ?? "";
      for (const entry of body.matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>\s*(<([0-9a-fA-F\s]+)>|\[([\s\S]*?)\])/g)) {
        if (!entry[1] || !entry[2]) continue;
        const start = Number.parseInt(hexKey(entry[1]), 16);
        const end = Number.parseInt(hexKey(entry[2]), 16);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 512) continue;
        const width = hexKey(entry[1]).length;
        if (entry[4]) {
          for (let code = start; code <= end; code += 1) {
            map.set(code.toString(16).toUpperCase().padStart(width, "0"), incrementHexUnicode(entry[4], code - start));
          }
        } else if (entry[5]) {
          const values = Array.from(entry[5].matchAll(/<([0-9a-fA-F\s]+)>/g)).map((match) => match[1]).filter(Boolean);
          values.forEach((value, index) => {
            map.set((start + index).toString(16).toUpperCase().padStart(width, "0"), decodeHexString(value!));
          });
        }
      }
    }

    if (map.size > 0) maps.push(map);
  }
  return maps;
}

function scoreDecodedText(value: string): number {
  const clean = cleanExtractedText(value);
  if (!clean) return 0;
  const letters = clean.match(/\p{L}/gu)?.length ?? 0;
  const numbers = clean.match(/\p{N}/gu)?.length ?? 0;
  const spaces = clean.match(/\s/g)?.length ?? 0;
  const tokens = clean.split(/\s+/).filter(Boolean);
  const shortTokens = tokens.filter((token) => token.length === 1).length;
  const fragmentationPenalty = tokens.length > 20 ? shortTokens / tokens.length : 0;
  return (letters * 2 + numbers + spaces * 0.2) / clean.length - fragmentationPenalty;
}

function decodeBytesWithMap(bytes: Buffer, map: ToUnicodeMap): string {
  const widths = Array.from(new Set(Array.from(map.keys()).map((key) => key.length / 2))).sort((a, b) => b - a);
  let result = "";
  for (let i = 0; i < bytes.length;) {
    let matched = false;
    for (const width of widths) {
      if (i + width > bytes.length) continue;
      const key = bytes.subarray(i, i + width).toString("hex").toUpperCase();
      const value = map.get(key);
      if (value) {
        result += value;
        i += width;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += String.fromCharCode(bytes[i]!);
      i += 1;
    }
  }
  return result;
}

function decodePdfBytes(bytes: Buffer, maps: ToUnicodeMap[], fallback: string): string {
  const candidates = [fallback, ...maps.map((map) => decodeBytesWithMap(bytes, map))];
  return candidates.sort((a, b) => scoreDecodedText(b) - scoreDecodedText(a))[0] ?? fallback;
}

function extractPdfTextOperators(content: string, maps: ToUnicodeMap[]): string[] {
  const chunks: string[] = [];
  const tjLiteral = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")/g;
  for (const match of content.matchAll(tjLiteral)) {
    if (match[1]) chunks.push(decodePdfBytes(literalBytes(match[1]), maps, decodeLiteralString(match[1])));
  }

  const tjHex = /<([0-9a-fA-F\s]+)>\s*Tj/g;
  for (const match of content.matchAll(tjHex)) {
    if (match[1]) {
      const bytes = Buffer.from(hexKey(match[1]), "hex");
      chunks.push(decodePdfBytes(bytes, maps, decodeHexString(match[1])));
    }
  }

  const tjArray = /\[([\s\S]*?)\]\s*TJ/g;
  for (const match of content.matchAll(tjArray)) {
    const body = match[1] ?? "";
    const strings: string[] = [];
    for (const literal of body.matchAll(literalPattern())) {
      if (literal[1]) strings.push(decodePdfBytes(literalBytes(literal[1]), maps, decodeLiteralString(literal[1])));
    }
    const hexStrings = body.matchAll(/<([0-9a-fA-F\s]+)>/g);
    for (const hex of hexStrings) {
      if (hex[1]) {
        const bytes = Buffer.from(hexKey(hex[1]), "hex");
        strings.push(decodePdfBytes(bytes, maps, decodeHexString(hex[1])));
      }
    }
    if (strings.length) chunks.push(strings.join(""));
  }
  return chunks;
}

function streamBuffers(pdf: Buffer): Buffer[] {
  const binary = pdf.toString("latin1");
  const streams: Buffer[] = [];
  const marker = /stream\r?\n/g;
  for (const match of binary.matchAll(marker)) {
    const streamStart = (match.index ?? 0) + match[0].length;
    const end = binary.indexOf("endstream", streamStart);
    if (end === -1) continue;
    const dictStart = Math.max(0, (match.index ?? 0) - 2000);
    const dict = binary.slice(dictStart, match.index ?? 0);
    const raw = Buffer.from(binary.slice(streamStart, end).replace(/\r?\n$/, ""), "latin1");
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        streams.push(inflateSync(raw));
      } catch {
        // A failed inflate usually means an image/binary stream. Do not parse it as text.
      }
    } else {
      streams.push(raw);
    }
  }
  return streams;
}

export function extractPdfTextFromBuffer(pdf: Buffer): string {
  const streams = streamBuffers(pdf);
  const maps = parseToUnicodeMaps(streams);
  const chunks: string[] = [];
  for (const candidate of streams) {
    if (candidate.length > MAX_STREAM_TEXT_BYTES) continue;
    const content = candidate.toString("latin1");
    if (!/\bBT\b|Tj|TJ/.test(content)) continue;
    chunks.push(...extractPdfTextOperators(content, maps).filter(looksLikeHumanText));
  }
  const text = cleanExtractedText(chunks.join(" "));
  return looksLikeHumanText(text) ? text : "";
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isImage(file: File): boolean {
  return /^image\/(png|jpe?g)$/i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

function isPlainText(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    /\.(txt|md|csv|tsv|json)$/i.test(file.name)
  );
}

function normalizedOcrMimeType(file: File): string | null {
  if (isPdf(file)) return "application/pdf";
  if (/^image\/png$/i.test(file.type) || /\.png$/i.test(file.name)) return "image/png";
  if (/^image\/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name)) return "image/jpeg";
  return null;
}

function shouldTryOcr(file: File, local: PlanTextExtraction): boolean {
  if (local.status === "text_extracted") return false;
  return Boolean(normalizedOcrMimeType(file));
}

function extractionFromText(text: string, source: PlanTextExtractionSource): PlanTextExtraction {
  const clean = cleanExtractedText(text);
  return clean
    ? { status: "text_extracted", source, chars: clean.length, excerpt: clean.slice(0, EXCERPT_LIMIT) }
    : { status: "no_text", source, chars: 0, message: "empty_ocr_result" };
}

interface YandexOcrResponse {
  textAnnotation?: {
    fullText?: string;
    blocks?: Array<{ lines?: Array<{ text?: string }> }>;
  };
}

function textFromYandexOcrResponse(json: YandexOcrResponse): string {
  const fullText = json.textAnnotation?.fullText;
  if (typeof fullText === "string" && fullText.trim()) return fullText;
  return (
    json.textAnnotation?.blocks
      ?.flatMap((block) => block.lines ?? [])
      .map((line) => line.text)
      .filter((line): line is string => Boolean(line?.trim()))
      .join("\n") ?? ""
  );
}

export async function yandexVisionOcr(file: File, options: PlanOcrOptions = {}): Promise<PlanTextExtraction> {
  const folderId = options.folderId ?? process.env.YC_FOLDER_ID;
  const apiKey = options.apiKey ?? process.env.YC_API_KEY;
  const mimeType = normalizedOcrMimeType(file);

  if (!mimeType) return { status: "unsupported", source: "none", chars: 0, message: "ocr_unsupported_file_type" };
  if (!folderId || !apiKey) return { status: "unsupported", source: "none", chars: 0, message: "ocr_not_configured" };

  const res = await fetch(YANDEX_OCR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${apiKey}`,
      "x-folder-id": folderId,
    },
    body: JSON.stringify({
      content: Buffer.from(await file.arrayBuffer()).toString("base64"),
      mimeType,
      languageCodes: options.languageCodes ?? ["ru", "en"],
      model: options.model ?? process.env.YC_OCR_MODEL ?? "page",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      status: "failed",
      source: "vision_ocr",
      chars: 0,
      message: `ocr_http_${res.status}: ${body.slice(0, 80)}`,
    };
  }

  const json = (await res.json()) as YandexOcrResponse;
  return extractionFromText(textFromYandexOcrResponse(json), "vision_ocr");
}

export async function extractPlanFileText(
  file: File,
  options: PlanTextExtractionOptions = {},
): Promise<PlanTextExtraction> {
  if (file.size > MAX_TEXT_BYTES) {
    return { status: "unsupported", source: "none", chars: 0, message: "file_too_large_for_text_extraction" };
  }

  try {
    if (isPlainText(file)) {
      const text = cleanExtractedText(await file.text());
      return text
        ? { status: "text_extracted", source: "plain_text", chars: text.length, excerpt: text.slice(0, EXCERPT_LIMIT) }
        : { status: "no_text", source: "plain_text", chars: 0, message: "empty_text_file" };
    }

    if (isPdf(file)) {
      const text = extractPdfTextFromBuffer(Buffer.from(await file.arrayBuffer()));
      const local: PlanTextExtraction = text
        ? { status: "text_extracted", source: "pdf_text", chars: text.length, excerpt: text.slice(0, EXCERPT_LIMIT) }
        : { status: "no_text", source: "pdf_text", chars: 0, message: "pdf_text_layer_not_found" };
      if (!shouldTryOcr(file, local)) return local;
      return await (options.ocrClient ?? yandexVisionOcr)(file, options.ocr);
    }

    if (isImage(file)) {
      return await (options.ocrClient ?? yandexVisionOcr)(file, options.ocr);
    }

    return { status: "unsupported", source: "none", chars: 0, message: "unsupported_file_type" };
  } catch {
    return { status: "failed", source: "none", chars: 0, message: "text_extraction_failed" };
  }
}
