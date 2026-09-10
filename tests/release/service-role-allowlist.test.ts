import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

const adminFactory = vi.hoisted(() => vi.fn(() => ({ syntheticClient: true })));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminFactory }));
import { createScopedServiceClient } from "../../lib/supabase/token-scoped";

const callers: Readonly<Record<string, string>> = {
  "app/api/intake/start/route.ts": "intake-start",
  "app/api/intake/submit/route.ts": "intake-submit",
  "app/api/intake/upload/route.ts": "intake-upload",
  "app/api/client/create/route.ts": "client-bootstrap",
  "app/api/proposal/respond/route.ts": "proposal-response",
  "app/p/[public_token]/page.tsx": "public-proposal",
  "app/b/[token]/page.tsx": "public-brief",
  "app/room/[access_token]/page.tsx": "participant-room",
  "app/api/brief/custom-question/plan-upload/route.ts": "authenticated-plan-upload",
  "app/api/project-room/task-status/route.ts": "participant-task-status",
  "lib/rate-limit.ts": "system-rate-limit",
  "lib/llm/recording.ts": "system-ai-recording",
  "app/api/account/delete/route.ts": "authenticated-account-delete",
  "app/api/integrations/telegram/webhook/route.ts": "system-telegram-webhook",
  "lib/integration-gateway/runtime/worker-client.ts": "system-integration-worker"
};

// Exact temporary inventory, not permission for new usages. WP-26 removes the
// authenticated studio/dashboard callers where existing RLS is sufficient.
// Public token-bound dependencies remain here until their request-bound
// contract exists; each is classified explicitly in WP-26 evidence.
const residualRawCallers: Readonly<Record<string, string>> = {
  "app/dashboard/projects/[id]/page.tsx": "BLOCKED_HOTSPOT: private client-uploads signing needs a project-scoped Storage RLS policy",
  "lib/intake.ts": "BLOCKED_HOTSPOT / class (b): public token path needs a split from authenticated helpers or an approved request-bound contract",
  "lib/designer.ts": "BLOCKED_HOTSPOT / class (b): public token path needs a split from authenticated helpers or an approved request-bound contract",
  "app/join/[token]/page.tsx": "BLOCKED_HOTSPOT: invite preview is unauthenticated and existing RLS has no token lookup contract",
  "app/join/[token]/actions.ts": "BLOCKED_HOTSPOT: invite acceptance needs an atomic request-bound contract; existing RLS cannot see invited rows",
  "app/api/pilot/route.ts": "BLOCKED_HOTSPOT: anonymous fixed event insert needs an additive RLS policy",
};
const helper = "lib/supabase/token-scoped.ts";
const rawModule = "lib/supabase/admin";
const scopedModule = "lib/supabase/token-scoped";

function modulePath(file: string, specifier: string): string {
  const path = specifier.startsWith("@/") ? specifier.slice(2)
    : specifier.startsWith(".") ? posix.join(posix.dirname(file), specifier) : specifier;
  return posix.normalize(path).replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

function violations(file: string, source: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const failures: string[] = [];
  const scopedNames = new Set<string>();
  const privilegedNames = new Set<string>();
  const client = ast.statements.some((node) => ts.isExpressionStatement(node)
    && ts.isStringLiteral(node.expression) && node.expression.text === "use client");
  function check(specifier: string, kind: string) {
    const target = modulePath(file, specifier);
    if (target !== rawModule && target !== scopedModule) return;
    const allowed = target === rawModule ? file === helper || file in residualRawCallers : file in callers;
    if (!allowed || client || kind !== "import") failures.push(`${file}: ${kind} ${target}`);
  }
  // Only direct factory calls (possibly parenthesized) and type queries are
  // permitted. Factories may not escape through aliases, returns or exports.
  // Collect bindings first so placing an import after a use is not a bypass.
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = modulePath(file, statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    if ((target === rawModule || target === scopedModule) && bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        privilegedNames.add(item.name.text);
        if (target === scopedModule) scopedNames.add(item.name.text);
      }
    }
  }
  function unwrap(expression: ts.Expression): ts.Expression {
    return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
  }
  function visit(node: ts.Node) {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      check(node.moduleReference.expression.text, "import equals/require");
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      check(specifier, ts.isExportDeclaration(node) ? "re-export" : "import");
      const target = modulePath(file, specifier);
      if (ts.isImportDeclaration(node) && (target === rawModule || target === scopedModule)) {
        const bindings = node.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) {
          failures.push(`${file}: privileged import must use named bindings`);
        }
      }
    }
    if (ts.isCallExpression(node)) {
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        check(node.arguments[0].text, "dynamic import/require");
      }
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee) && scopedNames.has(callee.text)) {
        const purpose = node.arguments[0];
        if (node.arguments.length !== 1 || !purpose || !ts.isStringLiteral(purpose)
          || purpose.text !== callers[file]) failures.push(`${file}: caller purpose mismatch`);
      }
    }
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause
      && ts.isNamedExports(node.exportClause)) {
      for (const item of node.exportClause.elements) {
        if (privilegedNames.has((item.propertyName ?? item.name).text)) failures.push(`${file}: local privileged re-export`);
      }
    }
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)
      && privilegedNames.has(node.expression.text)) failures.push(`${file}: privileged default export`);
    if (ts.isIdentifier(node) && privilegedNames.has(node.text)) {
      const parent = node.parent;
      const isImportBinding = ts.isImportSpecifier(parent);
      const isTypeQuery = ts.isTypeQueryNode(parent) && parent.exprName === node;
      let expression: ts.Node = node;
      while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
      const directCall = ts.isCallExpression(expression.parent) && expression.parent.expression === expression;
      if (!isImportBinding && !isTypeQuery && !directCall) {
        failures.push(`${file}: privileged factory reference escapes direct call`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return failures;
}

function scan(root: string): string[] {
  const failures: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        failures.push(...violations(relative(root, path).split("\\").join("/"), readFileSync(path, "utf8")));
      }
    }
  }
  for (const directory of ["app", "lib", "components", "scripts"]) {
    try { walk(join(root, directory)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return failures;
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("service-role import boundary", () => {
  it("allows only inventoried runtime imports and exact caller purposes", () => {
    expect(scan(process.cwd())).toEqual([]);
  });

  it("detects a real new on-disk caller even when the factory is aliased", () => {
    const root = mkdtempSync(join(tmpdir(), "remhaos-service-role-negative-"));
    try {
      const route = join(root, "app/api/unlisted/route.ts");
      mkdirSync(dirname(route), { recursive: true });
      writeFileSync(route, 'import { createAdminClient as ordinaryClient } from "@/lib/supabase/admin"; ordinaryClient();');
      expect(scan(root)).toEqual(["app/api/unlisted/route.ts: import lib/supabase/admin"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    'export { createAdminClient as ordinaryClient } from "@/lib/supabase/admin";',
    'export * from "../../../lib/supabase/admin";',
    'const client = import("@/lib/supabase/admin");',
    'const client = require("@/lib/supabase/admin");',
    'import client = require("@/lib/supabase/admin");',
    'import * as client from "@/lib/supabase/admin";',
    'import { createScopedServiceClient as client } from "@/lib/supabase/token-scoped"; client("intake-start");',
  ])("rejects import/re-export bypass: %s", (source) => {
    expect(violations("app/api/unlisted/route.ts", source).length).toBeGreaterThan(0);
  });

  it("rejects wrong purpose and client-side usage even in an allowed path", () => {
    const importLine = 'import { createScopedServiceClient as client } from "@/lib/supabase/token-scoped";';
    expect(violations("app/api/intake/start/route.ts", importLine + 'client("system-integration-worker");'))
      .toContain("app/api/intake/start/route.ts: caller purpose mismatch");
    expect(violations("app/api/intake/start/route.ts", '"use client";' + importLine + 'client("intake-start");').length)
      .toBeGreaterThan(0);
    expect(violations("app/api/intake/start/route.ts", importLine + 'export { client as ordinaryClient };').length)
      .toBeGreaterThan(0);
  });

  it.each([
    'export const ordinaryClient = createScopedServiceClient;',
    'const ordinaryClient = createScopedServiceClient; export { ordinaryClient };',
  ])("rejects a real two-file ordinary-module export bypass: %s", (escape) => {
    const root = mkdtempSync(join(tmpdir(), "remhaos-service-role-export-"));
    try {
      const allowed = join(root, "app/api/intake/start/route.ts");
      const unlisted = join(root, "app/api/unlisted/route.ts");
      mkdirSync(dirname(allowed), { recursive: true });
      mkdirSync(dirname(unlisted), { recursive: true });
      writeFileSync(allowed, 'import { createScopedServiceClient } from "@/lib/supabase/token-scoped";' + escape);
      writeFileSync(unlisted, 'import { ordinaryClient } from "../intake/start/route"; ordinaryClient("system-integration-worker");');
      expect(scan(root)).toContain("app/api/intake/start/route.ts: privileged factory reference escapes direct call");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    '(createScopedServiceClient)("system-integration-worker");',
    '((createScopedServiceClient))("system-integration-worker");',
    'const alias = createScopedServiceClient; alias("system-integration-worker");',
    'const alias = (createScopedServiceClient); alias("system-integration-worker");',
    'createScopedServiceClient.call(null, "system-integration-worker");',
  ])("rejects parenthesized or aliased purpose bypass: %s", (usage) => {
    const source = 'import { createScopedServiceClient } from "@/lib/supabase/token-scoped";' + usage;
    expect(violations("app/api/intake/start/route.ts", source).length).toBeGreaterThan(0);
  });

  it("allows a parenthesized direct call only with the exact purpose", () => {
    expect(violations("app/api/intake/start/route.ts",
      'import { createScopedServiceClient } from "@/lib/supabase/token-scoped"; ((createScopedServiceClient))("intake-start");'))
      .toEqual([]);
  });

  it("passes known purpose to the existing factory without new capabilities", () => {
    expect(createScopedServiceClient("intake-start")).toEqual({ syntheticClient: true });
    expect(adminFactory).toHaveBeenCalledOnce();
  });

  it("rejects unknown runtime purpose and browser execution before the factory", () => {
    expect(() => Reflect.apply(createScopedServiceClient, undefined, ["unlisted"]))
      .toThrow("service_role_purpose_not_allowed");
    vi.stubGlobal("window", {});
    expect(() => createScopedServiceClient("intake-start")).toThrow("service_role_purpose_not_allowed");
    expect(adminFactory).not.toHaveBeenCalled();
  });
});
