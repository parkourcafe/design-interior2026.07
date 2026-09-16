import { readFile } from "node:fs/promises";
import { extractCookieSession } from "./cookie-session";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("COOKIE_SESSION_PATH_REQUIRED");
  const result = extractCookieSession(await readFile(path, "utf8"));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(() => {
  process.stderr.write("COOKIE_SESSION_EXTRACTION_FAILED\n");
  process.exitCode = 1;
});
