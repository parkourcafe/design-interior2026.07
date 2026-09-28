// Файлы, которые клиент прикладывает к брифу (аудит 28.09, шаг 5). Раньше
// маршрут принимал любой файл любого размера под именем, которое прислал
// браузер. Теперь: только план или фото (JPG, PNG, WebP, PDF) до 15 МБ, тип —
// по первым байтам файла, а не по заявленному браузером; имя — безопасное.

export const CLIENT_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const CLIENT_UPLOAD_MAX_FILES = 10;

export type ClientUploadKind = { readonly mediaType: string; readonly extension: string };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Тип по сигнатуре файла; null — не план и не фото. */
export function sniffClientUpload(head: Uint8Array): ClientUploadKind | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mediaType: "application/pdf", extension: "pdf" };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mediaType: "image/jpeg", extension: "jpg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mediaType: "image/png", extension: "png" };
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mediaType: "image/webp", extension: "webp" };
  }
  return null;
}

/** Имя для хранилища: без путей, служебных символов и с расширением по типу. */
export function safeClientFileName(name: string, extension: string): string {
  const base = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return `${base || "file"}.${extension}`;
}
