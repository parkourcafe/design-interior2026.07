import { createHash } from "node:crypto";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error(`CLONE_SQL_${code}`); };
const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export const SQL_PINS = freeze({
  sourceCommit: "d5f21817f34f336e10c562a3515d5004711d25e5",
  manifestSha256: "bf772ca1d8253160310ea442068e49295dd172503f837fbf689a9f9fd6d10230",
  ledgerSha256: "9bc7e7b4efffffed76e69840393ada020eee156a61a769635cb4d2d2180e36ab",
  baselineVersion: "20260716071024",
  plainVersions: ["20260808050000", "20260808060000", "20260810040000"],
});

// Lexical boundaries only: this is deliberately not a PostgreSQL semantic parser.
// The trusted connection must use standard_conforming_strings=on. E strings
// have their own backslash rules; dollar bodies and comments are opaque.
export function scanSqlStatements(sql) {
  if (typeof sql !== "string" || sql.includes("\0") || Buffer.byteLength(sql) > 8 * 1024 * 1024) fail("INPUT_INVALID");
  const statements = [];
  let start = 0, i = 0, depth = 0, tokens = [], bodies = [];
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (sql.startsWith("--", i)) {
      const rest = sql.slice(i + 2).search(/[\r\n]/);
      i = rest < 0 ? sql.length : i + 3 + rest; continue;
    }
    if (sql.startsWith("/*", i)) {
      let nesting = 1; i += 2;
      while (i < sql.length && nesting) {
        if (sql.startsWith("/*", i)) { nesting++; i += 2; }
        else if (sql.startsWith("*/", i)) { nesting--; i += 2; }
        else i++;
      }
      if (nesting) fail("UNTERMINATED_COMMENT");
      continue;
    }
    if (c === "\\") fail("PSQL_META_FORBIDDEN");
    if (c === ":" && sql[i + 1] !== ":" && sql[i - 1] !== ":" && sql[i + 1] !== "=") fail("PSQL_INTERPOLATION_FORBIDDEN");
    const escape = (c === "e" || c === "E") && sql[i + 1] === "'";
    if (c === "'" || c === '"' || escape) {
      const quote = escape ? "'" : c;
      const offset = i;
      i += escape ? 2 : 1;
      let closed = false;
      while (i < sql.length) {
        if (escape && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) fail("UNTERMINATED_QUOTE");
      tokens.push(quote === '"' ? "<identifier>" : "<literal>");
      bodies.push({ kind: quote === '"' ? "identifier" : "string", sha256: sha(sql.slice(offset, i)) });
      continue;
    }
    if (c === "$") {
      const delimiter = /^(?:\$\$|\$[A-Za-z_][A-Za-z_0-9]*\$)/.exec(sql.slice(i))?.[0];
      if (!delimiter) fail("UNSUPPORTED_DOLLAR_TOKEN");
      const end = sql.indexOf(delimiter, i + delimiter.length);
      if (end < 0) fail("UNTERMINATED_DOLLAR_QUOTE");
      bodies.push({ kind: "dollar", sha256: sha(sql.slice(i, end + delimiter.length)) });
      tokens.push("<literal>"); i = end + delimiter.length; continue;
    }
    if (c === ";") {
      if (depth) fail("UNBALANCED_PARENTHESES");
      if (!tokens.length) fail("EMPTY_STATEMENT");
      statements.push({ sql: sql.slice(start, i + 1), tokens, bodies });
      i++; start = i; tokens = []; bodies = []; continue;
    }
    if (c === "(") depth++;
    if (c === ")" && --depth < 0) fail("UNBALANCED_PARENTHESES");
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i))?.[0];
    if (word) { tokens.push(word.toUpperCase()); i += word.length; }
    else { tokens.push(c); i++; }
  }
  if (depth) fail("UNBALANCED_PARENTHESES");
  if (tokens.length) fail("MISSING_TERMINATOR");
  // Preserve final comments, including their original newline behavior.
  if (statements.length) statements[statements.length - 1].sql += sql.slice(start);
  return freeze(statements);
}

function classify(statement) {
  const t = statement.tokens;
  const words = t.join(" ");
  if (["BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE", "PREPARE"].includes(t[0])) fail("TRANSACTION_CONTROL");
  if (!["DO", "CREATE", "REVOKE", "GRANT", "ALTER", "INSERT", "SET", "DROP", "UPDATE", "SELECT"].includes(t[0])) fail("STATEMENT_CLASS_UNSUPPORTED");
  if (/^(CREATE|DROP) (DATABASE|TABLESPACE|SUBSCRIPTION)\b/.test(words)
      || /^ALTER (SYSTEM|SUBSCRIPTION|DATABASE|TABLESPACE)\b/.test(words)
      || /\bCONCURRENTLY\b/.test(words)
      || /^ALTER TYPE .* ADD VALUE\b/.test(words)) fail("NONTRANSACTIONAL_SQL");
  const localSettings = [];
  if (t[0] === "SET") {
    const local = t[1] === "LOCAL";
    const name = t[local ? 2 : 1];
    if (!["CHECK_FUNCTION_BODIES", "SEARCH_PATH"].includes(name)) fail("SETTING_UNSUPPORTED");
    const tail = t.slice(local ? 3 : 2);
    if (tail.length !== 2 || !["=", "TO"].includes(tail[0])
        || (name === "CHECK_FUNCTION_BODIES" ? tail[1] !== "ON" : tail[1] !== "<literal>")) fail("SETTING_FORM_UNSUPPORTED");
    if (name === "SEARCH_PATH" && (!local || statement.bodies.at(-1)?.sha256 !== sha("''"))) fail("SETTING_FORM_UNSUPPORTED");
    if (local) localSettings.push(name.toLowerCase());
  }
  return { class: t[0], sqlSha256: sha(statement.sql), tokens: t,
    opaqueBodies: statement.bodies, localSettings,
    proceduralOrCatalogReviewRequired: t[0] === "DO" || t[0] === "SELECT" || statement.bodies.some((b) => b.kind === "dollar") };
}

export function normalizeMigrationSql(sql, { wrapped } = {}) {
  if (typeof wrapped !== "boolean") fail("WRAPPER_EXPECTATION_REQUIRED");
  let statements = scanSqlStatements(sql);
  if (wrapped) {
    if (statements.length < 3 || statements[0].tokens.join(" ") !== "BEGIN"
        || statements.at(-1).tokens.join(" ") !== "COMMIT") fail("WRAPPER_MISMATCH");
    statements = statements.slice(1, -1);
  }
  if (!statements.length) fail("EMPTY_BODY");
  const inventory = statements.map(classify);
  return freeze({ sql: statements.map((s) => s.sql).join("\n"), inventory,
    localSettings: [...new Set(inventory.flatMap((s) => s.localSettings))],
    boundary: wrapped ? "FORMER_COMMIT_REQUIRES_VERIFIED_CONSTRAINT_RESET" : "PLAIN_SOURCE_NO_COMMIT_BOUNDARY" });
}

function verifiedText(bytes, expected) {
  if (!(bytes instanceof Uint8Array)) fail("BYTES_REQUIRED");
  // Copy before hashing/decoding; later mutation of caller buffers cannot alter plan.
  const copy = Buffer.from(bytes);
  if (sha(copy) !== expected) fail("SOURCE_DIGEST_MISMATCH");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(copy); }
  catch { fail("SOURCE_ENCODING_INVALID"); }
}

// No filesystem, connection, authority, or execution side effect. A successful
// compile is only an immutable source inventory; unresolved obligations forbid
// treating this result as an execution-ready transaction.
export function compileCloneRehearsalSql({ manifest, ledgerBytes, migrationBytes, auxiliaryBytes }) {
  const serialized = JSON.stringify(manifest);
  if (typeof serialized !== "string" || sha(serialized) !== SQL_PINS.manifestSha256) fail("MANIFEST_DIGEST_MISMATCH");
  manifest = JSON.parse(serialized);
  if (manifest.source.commit !== SQL_PINS.sourceCommit || manifest.source.migrationCount !== 98
      || manifest.source.ledgerSha256 !== SQL_PINS.ledgerSha256) fail("SOURCE_PIN_MISMATCH");
  const ledger = verifiedText(ledgerBytes, SQL_PINS.ledgerSha256).trim().split("\n").map((line) => {
    const m = /^([a-f0-9]{64})  (supabase\/migrations\/(\d{14})_[^\s/]+\.sql)$/.exec(line);
    if (!m) fail("LEDGER_INVALID");
    return { sha256: m[1], path: m[2], version: m[3] };
  });
  if (ledger.length !== 98 || JSON.stringify(ledger) !== JSON.stringify(manifest.source.migrations)
      || ledger[0].version !== SQL_PINS.baselineVersion) fail("LEDGER_MISMATCH");
  const texts = ledger.map((entry) => verifiedText(migrationBytes?.[entry.path], entry.sha256));
  // Validate all auxiliary bytes before compiling any source; only the two
  // exact hash-pinned ON_ERROR_STOP directives have a reviewed normalization.
  const aux = Object.entries(manifest.preconditions.auxiliary).map(([path, digest]) => ({ path, digest,
    text: verifiedText(auxiliaryBytes?.[path], digest) }));
  const migrations = ledger.slice(1).map((entry, index) => ({ ...entry,
    ...normalizeMigrationSql(texts[index + 1], { wrapped: !SQL_PINS.plainVersions.includes(entry.version) }) }));
  const auxiliary = aux.map(({ path, digest, text }) => {
    const directive = path !== "supabase/roles.sql";
    if (directive && !text.startsWith("\\set ON_ERROR_STOP on\n")) fail("AUXILIARY_DIRECTIVE_MISMATCH");
    const body = directive ? text.slice("\\set ON_ERROR_STOP on\n".length) : text;
    return { path, sha256: digest, driverDirective: directive ? "ON_ERROR_STOP=on" : null,
      ...normalizeMigrationSql(body, { wrapped: false }) };
  });
  const plan = { contract: "remhaos-clone-sql-inventory/1.0", sourceCommit: SQL_PINS.sourceCommit,
    manifestSha256: SQL_PINS.manifestSha256, ledgerSha256: SQL_PINS.ledgerSha256,
    baselineExcluded: SQL_PINS.baselineVersion, migrations, auxiliary,
    executionReady: false,
    unresolved: ["DISPOSABLE_EXACT_PLAN_COMPARISON", "QUALIFIED_CONSTRAINT_MODE_BOUNDARIES",
      "CAPTURE_AND_RESTORE_LOCAL_SETTINGS", "PROCEDURAL_AND_CATALOG_EFFECTS",
      "AUXILIARY_ORDER_AND_HOSTED_ROLE_PREFLIGHT", "TRANSACTION_CLOCK_AND_LOCK_SEMANTICS"],
    requiredConnectionSettings: { standard_conforming_strings: "on", ON_ERROR_STOP: "on" } };
  return freeze({ ...plan, normalizedPlanSha256: sha(JSON.stringify(plan)) });
}
