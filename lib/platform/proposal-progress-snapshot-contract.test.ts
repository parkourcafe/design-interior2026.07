import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const proposalPageSource = readFileSync(
  new URL("../../app/dashboard/projects/[id]/proposal/page.tsx", import.meta.url),
  "utf8",
);

function findMatchingParenthesis(source: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("an unsent proposal draft persists only bounded evidence and fails closed when governed workflow persistence fails", () => {
  const rpcMarker = /\.rpc\(\s*["']get_or_create_m1_proposal_draft["']/.exec(
    proposalPageSource,
  );

  expect(rpcMarker, "proposal drafts must invoke the governed workflow RPC").not.toBeNull();
  if (rpcMarker?.index === undefined) throw new Error("workflow RPC call is absent");

  const openParenthesis = proposalPageSource.indexOf("(", rpcMarker.index);
  const closeParenthesis = findMatchingParenthesis(
    proposalPageSource,
    openParenthesis,
  );

  expect(closeParenthesis, "workflow RPC invocation must be statically inspectable").toBeGreaterThan(
    openParenthesis,
  );

  const rpcInvocation = proposalPageSource.slice(
    rpcMarker.index,
    closeParenthesis + 1,
  );
  const assignmentPrefix = proposalPageSource.slice(
    Math.max(0, rpcMarker.index - 500),
    rpcMarker.index,
  );

  const destructuredResult = assignmentPrefix.match(
    /(?:const|let)\s*\{([^{}]*\berror\b[^{}]*)\}\s*=\s*await[\s\S]{0,160}$/,
  );
  const assignedResult = assignmentPrefix.match(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await[\s\S]{0,160}$/,
  );

  let errorExpression: string | undefined;
  if (destructuredResult) {
    const errorBinding = destructuredResult[1]!.match(
      /(?:^|,)\s*error\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?=,|$)/,
    );
    if (errorBinding) errorExpression = errorBinding[1] ?? "error";
  } else if (assignedResult) {
    errorExpression = `${assignedResult[1]}.error`;
  }

  expect(
    errorExpression,
    "the result of get_or_create_m1_proposal_draft must retain its error",
  ).toBeTruthy();
  if (!errorExpression) throw new Error("workflow RPC error is ignored");

  const codeAfterRpc = proposalPageSource.slice(
    closeParenthesis + 1,
    closeParenthesis + 1_200,
  );
  const failClosedPattern = new RegExp(
    `if\\s*\\(\\s*${escapeRegExp(errorExpression)}\\b[\\s\\S]{0,600}?\\)\\s*(?:\\{[\\s\\S]{0,600}?\\bthrow\\b|throw\\b)`,
  );

  expect(
    codeAfterRpc,
    "an RPC error must be checked after persistence and terminate rendering",
  ).toMatch(failClosedPattern);

  const requiredBoundedEvidence: Array<[string, RegExp]> = [
    ["project identity", /["']?(?:p_)?project_id["']?\s*:/],
    ["question count", /["']?(?:question_count|questionCount)["']?\s*:/],
    ["package key", /["']?(?:package_key|packageKey)["']?\s*:/],
    ["fee-presence flag", /["']?(?:has_fee|hasFee)["']?\s*:/],
    ["section count", /["']?(?:section_count|sectionCount)["']?\s*:/],
    [
      "content digest",
      /["']?(?:content_digest|contentDigest|section_digest|sectionDigest|sections_digest|sectionsDigest)["']?\s*:/,
    ],
  ];

  for (const [label, pattern] of requiredBoundedEvidence) {
    expect(rpcInvocation, `workflow snapshot must include bounded ${label}`).toMatch(
      pattern,
    );
  }

  const forbiddenPayloadProperty =
    /(?:^|[{,])\s*["']?(?:sections|proposal_sections|proposalSections|price|pricing|price_details|priceDetails|price_breakdown|priceBreakdown|fee_details|feeDetails|client_text|clientText|client_name|clientName|pain_points|painPoints|answers|passport)["']?\s*:/m;
  const forbiddenShorthand =
    /(?:^|[{,])\s*(?:sections|price|pricing|answers|passport)\s*(?=[,}])/m;
  const forbiddenSpread =
    /\.\.\.\s*(?:proposal|sections|price|pricing|answers|passport|client)\b/;

  expect(
    rpcInvocation,
    "workflow snapshots must not copy proposal sections, client text, or full price details",
  ).not.toMatch(forbiddenPayloadProperty);
  expect(rpcInvocation, "workflow snapshots must not use unsafe shorthand fields").not.toMatch(
    forbiddenShorthand,
  );
  expect(rpcInvocation, "workflow snapshots must not spread rich proposal data").not.toMatch(
    forbiddenSpread,
  );
});
