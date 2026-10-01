// Файлы, которые клиент прикладывает к брифу (аудит 28.09, шаг 5). Раньше
// маршрут принимал любой файл любого размера под именем, которое прислал
// браузер. Теперь: только план или фото (JPG, PNG, WebP, PDF) до 4 МБ, тип —
// по первым байтам файла, а не по заявленному браузером; имя — безопасное.

// 4 МБ, а не больше: Vercel не пропускает в функцию тело запроса больше 4,5 МБ,
// и обещание «до 15 МБ» было бы неправдой.
export const CLIENT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
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

const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Имя для ключа хранилища: только латиница, цифры, `_` и `-`, с расширением по
 * типу. Supabase Storage не принимает ключи с кириллицей («Invalid key»), а
 * клиенты чаще всего называют файлы по-русски: «План квартиры.pdf» →
 * `Plan_kvartiry.pdf`. Исходное имя хранится отдельно (clientFileDisplayName).
 */
export function safeClientFileName(name: string, extension: string): string {
  const base = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFKC")
    .replace(/[а-яё]/gi, (char) => {
      const latin = CYRILLIC_TO_LATIN[char.toLowerCase()] ?? "";
      return char === char.toLowerCase() ? latin : latin.charAt(0).toUpperCase() + latin.slice(1);
    })
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return `${base || "file"}.${extension}`;
}

/** Исходное имя файла для показа дизайнеру: без путей и управляющих символов. */
export function clientFileDisplayName(name: string): string {
  const cleaned = name
    .split(/[\\/]/).pop()!
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .trim()
    .slice(0, 200);
  return cleaned || "file";
}
