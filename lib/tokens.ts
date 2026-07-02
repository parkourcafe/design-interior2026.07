import { randomBytes } from "node:crypto";

// URL-safe непредсказуемый токен для публичных ссылок (intake / КП).
export function makeToken(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}
