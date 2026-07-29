import { QUESTIONS } from "@/lib/brief/questions";

export const INITIAL_BRIEF_INPUT_LIMITS = {
  maxBodyBytes: 64 * 1024,
  maxTokenLength: 256,
  maxAnswerKeys: 54,
  maxNestingDepth: 8,
  maxArrayLength: 64,
  maxObjectProperties: 64,
  maxKeyLength: 64,
  maxStringLength: 8192,
} as const;

export type InitialBriefJsonValue =
  | null
  | boolean
  | number
  | string
  | InitialBriefJsonValue[]
  | { [key: string]: InitialBriefJsonValue };

export class InitialBriefRequestTooLargeError extends Error {
  constructor() {
    super("initial brief request exceeds the byte limit");
    this.name = "InitialBriefRequestTooLargeError";
  }
}

export function declaredInitialBriefRequestTooLarge(
  headers: Headers,
  maxBytes = INITIAL_BRIEF_INPUT_LIMITS.maxBodyBytes,
): boolean {
  const value = headers.get("content-length");
  if (value === null) return false;
  if (!/^\d+$/.test(value.trim())) return true;

  const contentLength = Number(value);
  return !Number.isSafeInteger(contentLength) || contentLength > maxBytes;
}

export async function readBoundedInitialBriefBody(
  request: Request,
  maxBytes = INITIAL_BRIEF_INPUT_LIMITS.maxBodyBytes,
): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new InitialBriefRequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

const ALLOWED_ANSWER_KEYS = new Set([
  ...QUESTIONS.map((question) => question.id),
  ...Array.from({ length: 15 }, (_, index) => `custom_${index}`),
  "comments",
]);

function invalidInput(): never {
  throw new Error("invalid initial brief input");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateJsonValue(value: unknown, depth: number): void {
  if (depth > INITIAL_BRIEF_INPUT_LIMITS.maxNestingDepth) {
    invalidInput();
  }

  if (value === null || typeof value === "boolean") {
    return;
  }

  if (typeof value === "string") {
    if (value.length > INITIAL_BRIEF_INPUT_LIMITS.maxStringLength) {
      invalidInput();
    }
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalidInput();
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > INITIAL_BRIEF_INPUT_LIMITS.maxArrayLength) {
      invalidInput();
    }
    for (const item of value) {
      validateJsonValue(item, depth + 1);
    }
    return;
  }

  if (!isPlainObject(value)) {
    invalidInput();
  }

  const entries = Object.entries(value);
  if (entries.length > INITIAL_BRIEF_INPUT_LIMITS.maxObjectProperties) {
    invalidInput();
  }

  for (const [key, nestedValue] of entries) {
    if (key.length > INITIAL_BRIEF_INPUT_LIMITS.maxKeyLength) {
      invalidInput();
    }
    validateJsonValue(nestedValue, depth + 1);
  }
}

export function parseInitialBriefInput(rawBody: string): {
  token: string;
  answers: Record<string, InitialBriefJsonValue>;
} {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      INITIAL_BRIEF_INPUT_LIMITS.maxBodyBytes
  ) {
    invalidInput();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    invalidInput();
  }

  if (!isPlainObject(parsed)) {
    invalidInput();
  }

  const rootKeys = Object.keys(parsed);
  if (
    rootKeys.length !== 2 ||
    !rootKeys.includes("token") ||
    !rootKeys.includes("answers")
  ) {
    invalidInput();
  }

  const { token, answers } = parsed;
  if (
    typeof token !== "string" ||
    token.trim().length === 0 ||
    token.length > INITIAL_BRIEF_INPUT_LIMITS.maxTokenLength
  ) {
    invalidInput();
  }

  if (!isPlainObject(answers)) {
    invalidInput();
  }

  const answerKeys = Object.keys(answers);
  if (answerKeys.length > INITIAL_BRIEF_INPUT_LIMITS.maxAnswerKeys) {
    invalidInput();
  }

  for (const answerKey of answerKeys) {
    if (
      answerKey.length > INITIAL_BRIEF_INPUT_LIMITS.maxKeyLength ||
      !ALLOWED_ANSWER_KEYS.has(answerKey)
    ) {
      invalidInput();
    }
    validateJsonValue(answers[answerKey], 0);
  }

  return {
    token,
    answers: answers as Record<string, InitialBriefJsonValue>,
  };
}
