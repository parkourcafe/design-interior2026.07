import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const storageAdapterDirectory = "lib/project-intelligence/adapters/storage";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).split("\\").join("/");
    if (relativePath === storageAdapterDirectory) return [];
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) expression = expression.expression;
  return expression;
}

function isSigningCall(expression: ts.Expression): boolean {
  const target = unwrap(expression);
  if (ts.isPropertyAccessExpression(target)) return target.name.text === "createSignedUrl";
  if (ts.isElementAccessExpression(target)) {
    const key = unwrap(target.argumentExpression);
    return (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
      key.text === "createSignedUrl";
  }
  return false;
}

function numericConstant(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): number | undefined {
  if (seen.has(expression)) return undefined;
  const visited = new Set(seen).add(expression);
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (ts.isParenthesizedExpression(expression)) {
    return numericConstant(expression.expression, checker, visited);
  }
  if (ts.isIdentifier(expression)) {
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
    if (
      declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const)
    ) return numericConstant(declaration.initializer, checker, visited);
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    const value = numericConstant(expression.operand, checker, visited);
    if (value === undefined) return undefined;
    if (expression.operator === ts.SyntaxKind.MinusToken) return -value;
    if (expression.operator === ts.SyntaxKind.PlusToken) return value;
  }
  if (ts.isBinaryExpression(expression)) {
    const left = numericConstant(expression.left, checker, visited);
    const right = numericConstant(expression.right, checker, visited);
    if (left === undefined || right === undefined) return undefined;
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: return left + right;
      case ts.SyntaxKind.MinusToken: return left - right;
      case ts.SyntaxKind.AsteriskToken: return left * right;
      case ts.SyntaxKind.SlashToken: return left / right;
      case ts.SyntaxKind.PercentToken: return left % right;
      case ts.SyntaxKind.AsteriskAsteriskToken: return left ** right;
    }
  }
  return undefined;
}

describe("signed URL TTL boundary", () => {
  it("does not pass an excessive or unverified TTL outside the storage adapter", () => {
    const violations: string[] = [];
    const files = ["app", "lib", "components"].flatMap((directory) =>
      sourceFiles(join(root, directory)),
    );

    const program = ts.createProgram(files, { noResolve: true, target: ts.ScriptTarget.Latest });
    const checker = program.getTypeChecker();
    for (const path of files) {
      const file = program.getSourceFile(path)!;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          isSigningCall(node.expression)
        ) {
          const wrapper = relative(root, path) === "lib/integration-gateway/file-intake/service.ts" &&
            node.expression.getText(file) === "this.storageAdapter.createSignedUrl" &&
            node.arguments.length === 1 && node.arguments[0]?.getText(file) === "authorization";
          if (wrapper) return;
          const ttl = node.arguments[1];
          if (!ttl) {
            const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
            violations.push(`${relative(root, path)}:${line + 1}: missing TTL`);
            return;
          }
          const value = numericConstant(ttl, checker);
          const guardedFileIntake = relative(root, path) === "lib/integration-gateway/file-intake/storage.ts" &&
            ttl.getText(file) === "authorization.ttlSeconds";
          if (guardedFileIntake) {
            let enclosing: ts.Node = node;
            while (enclosing.parent && !ts.isMethodDeclaration(enclosing)) enclosing = enclosing.parent;
            const guard = ts.isMethodDeclaration(enclosing) ? enclosing.body?.statements[0] : undefined;
            expect(guard && ts.isIfStatement(guard)).toBe(true);
            const compact = (statement: ts.Node | undefined) => statement?.getText(file).replace(/\s+/g, "");
            expect(compact(guard)).toBe(
              'if(authorization.bucket!=="client-uploads"||authorization.ttlSeconds<1||authorization.ttlSeconds>900){thrownewError("file_intake_storage_download_authorization_mismatch");}',
            );
            const signingStatement = ts.isMethodDeclaration(enclosing) ? enclosing.body?.statements[1] : undefined;
            const initializer = signingStatement && ts.isVariableStatement(signingStatement)
              ? signingStatement.declarationList.declarations[0]?.initializer : undefined;
            expect(initializer && ts.isAwaitExpression(initializer) ? initializer.expression === node : false).toBe(true);
            expect(compact(signingStatement)).toBe(
              'constresult=awaitthis.storage.from(authorization.bucket).createSignedUrl(authorization.objectKey,authorization.ttlSeconds);',
            );
          } else if (value === undefined || !Number.isFinite(value) || value > 900) {
            const { line } = file.getLineAndCharacterOfPosition(ttl.getStart(file));
            violations.push(`${relative(root, path)}:${line + 1}: TTL ${value ?? "unverified"} exceeds or lacks proof of the 900 limit`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }

    expect(files.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
