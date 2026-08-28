#!/usr/bin/env node

import { readFileSync } from "node:fs";

const patterns = [
  {
    name: "authorization_header",
    regex: /\bauthorization\s*:\s*bearer\s+(?!\[redacted\])[A-Za-z0-9._~+/-]{20,}=*/i,
  },
  {
    name: "bearer_token",
    regex: /\bbearer\s+(?!\[redacted\])[A-Za-z0-9._~+/-]{20,}=*/i,
  },
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}\b/,
  },
  {
    name: "url_password",
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i,
  },
  {
    name: "password_assignment",
    regex: /\bpassword\s*[:=]\s*(?!\[redacted\]|<redacted>|\*+)\S+/i,
  },
  {
    name: "token_assignment",
    regex: /\b(?:access_token|refresh_token|token_hash)\s*[:=]\s*(?!\[redacted\]|<redacted>|\*+)\S+/i,
  },
  {
    name: "magic_link",
    regex: /\/auth\/callback\?[^\s]*(?:token_hash|type=magiclink)/i,
  },
  {
    name: "session_storage",
    regex: /\bsession storage\b/i,
  },
  {
    name: "cookie_header",
    regex: /\bcookie\s*:\s*(?!\[redacted\]|<redacted>|\*+)\S+=\S+/i,
  },
];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("LOG_HYGIENE_USAGE scan-log-hygiene.mjs <log-file>...");
  process.exit(64);
}

let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) {
      console.error(`LOG_HYGIENE_LEAK ${pattern.name} ${file}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`LOG_HYGIENE_OK files=${files.length}`);
