const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function extractCookieSession(jar: string): { readonly userId: string; readonly sessionId: string } {
  const chunks = new Map<number, string>();
  for (const rawLine of jar.split("\n")) {
    const line = rawLine.startsWith("#HttpOnly_") ? rawLine.slice("#HttpOnly_".length) : rawLine;
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    const name = fields[5] ?? ""; const value = fields[6] ?? "";
    const match = /^sb-[A-Za-z0-9_-]+-auth-token(?:\.(\d+))?$/.exec(name);
    if (!match || !value) continue;
    const index = match[1] === undefined ? 0 : Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || chunks.has(index)) throw new Error("COOKIE_SESSION_INVALID");
    chunks.set(index, value);
  }
  if (chunks.size < 1 || [...chunks.keys()].some((_, index) => !chunks.has(index))) throw new Error("COOKIE_SESSION_MISSING");
  let encoded = [...chunks.entries()].sort(([left], [right]) => left - right).map(([, value]) => value).join("");
  if (encoded.startsWith("base64-")) encoded = decodeBase64Url(encoded.slice("base64-".length));
  let stored: unknown;
  try { stored = JSON.parse(encoded); } catch { throw new Error("COOKIE_SESSION_INVALID"); }
  const accessToken = typeof stored === "object" && stored !== null && "access_token" in stored
    ? (stored as { readonly access_token?: unknown }).access_token : undefined;
  if (typeof accessToken !== "string") throw new Error("COOKIE_SESSION_INVALID");
  const parts = accessToken.split(".");
  if (parts.length !== 3) throw new Error("COOKIE_SESSION_INVALID");
  let payload: unknown;
  try { payload = JSON.parse(decodeBase64Url(parts[1]!)); } catch { throw new Error("COOKIE_SESSION_INVALID"); }
  const userId = typeof payload === "object" && payload !== null && "sub" in payload
    ? (payload as { readonly sub?: unknown }).sub : undefined;
  const sessionId = typeof payload === "object" && payload !== null && "session_id" in payload
    ? (payload as { readonly session_id?: unknown }).session_id : undefined;
  if (typeof userId !== "string" || typeof sessionId !== "string" || !UUID.test(userId) || !UUID.test(sessionId)) {
    throw new Error("COOKIE_SESSION_INVALID");
  }
  return { userId: userId.toLowerCase(), sessionId: sessionId.toLowerCase() };
}
