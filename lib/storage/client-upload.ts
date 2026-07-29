export const CLIENT_UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CLIENT_UPLOAD_MAX_REQUEST_BYTES =
  CLIENT_UPLOAD_MAX_FILE_BYTES + 64 * 1024;

const MIME_EXTENSION = {
  "application/pdf": "pdf",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type ClientUploadMimeType = keyof typeof MIME_EXTENSION;

export class ClientUploadRequestTooLargeError extends Error {
  constructor() {
    super("client upload request exceeds the byte limit");
    this.name = "ClientUploadRequestTooLargeError";
  }
}

export function clientUploadMimeType(value: string): ClientUploadMimeType | null {
  const normalized = value.trim().toLowerCase();
  return normalized in MIME_EXTENSION
    ? (normalized as ClientUploadMimeType)
    : null;
}

export function clientUploadObjectPath(
  projectId: string,
  mimeType: ClientUploadMimeType,
): string {
  return `${projectId}/${crypto.randomUUID()}.${MIME_EXTENSION[mimeType]}`;
}

export function sanitizeClientUploadDisplayName(
  originalName: string,
  mimeType: ClientUploadMimeType,
): string {
  const basename = originalName.split(/[\\/]/).pop() ?? "";
  const sanitized = basename
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .slice(0, 120);

  return sanitized || `upload.${MIME_EXTENSION[mimeType]}`;
}

export function isProjectClientUploadPath(
  path: string,
  projectId: string,
): boolean {
  if (!path || !projectId || path.length > 512) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
  if (/%(?:2e|2f|5c)/i.test(path)) return false;

  const segments = path.split("/");
  if (segments.length !== 2 || segments[0] !== projectId) return false;

  const objectName = segments[1];
  return Boolean(objectName && objectName !== "." && objectName !== "..");
}

export function declaredUploadRequestTooLarge(
  headers: Headers,
  maxBytes = CLIENT_UPLOAD_MAX_REQUEST_BYTES,
): boolean {
  const value = headers.get("content-length");
  if (value === null) return false;
  if (!/^\d+$/.test(value.trim())) return true;

  const contentLength = Number(value);
  return !Number.isSafeInteger(contentLength) || contentLength > maxBytes;
}

export async function readBoundedUploadBody(
  request: Request,
  maxBytes = CLIENT_UPLOAD_MAX_REQUEST_BYTES,
): Promise<ArrayBuffer | null> {
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
        throw new ClientUploadRequestTooLargeError();
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
  return body.buffer;
}
