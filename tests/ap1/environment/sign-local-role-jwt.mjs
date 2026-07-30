import { createHmac } from "node:crypto";

const role = process.argv[2];
if (role !== "anon" && role !== "service_role") {
  throw new Error("AP1_LOCAL_JWT_ROLE_REJECTED");
}

let secret = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) secret += chunk;
if (Buffer.byteLength(secret) < 32) {
  throw new Error("AP1_LOCAL_JWT_SECRET_REJECTED");
}

const now = Math.floor(Date.now() / 1000);
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const signingInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
  iss: "supabase-demo",
  role,
  iat: now,
  exp: now + 3_600,
})}`;
const signature = createHmac("sha256", secret)
  .update(signingInput)
  .digest("base64url");

process.stdout.write(`${signingInput}.${signature}`);
