import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  join(process.cwd(), "app/dashboard/projects/[id]/proposal/editor.tsx"),
  "utf8",
);

function innermostBlockContaining(source: string, index: number): string {
  const openBraces: number[] = [];

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "{") openBraces.push(cursor);
    if (source[cursor] === "}") openBraces.pop();
  }

  const blockStart = openBraces.at(-1);
  if (blockStart === undefined) {
    throw new Error("Cannot isolate the successful proposal rebuild block");
  }

  let depth = 0;
  for (let cursor = blockStart; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") depth -= 1;
    if (depth === 0) return source.slice(blockStart, cursor + 1);
  }

  throw new Error("Proposal rebuild block is not closed");
}

describe("ProposalEditor rebuild approval invalidation", () => {
  it("clears both local approvals in the successful section replacement block", () => {
    const replacement = /setSections\(\s*[^)]*\.sections\s*\)/.exec(editorSource);

    expect(replacement, "a successful rebuild must replace proposal sections").not.toBeNull();
    if (!replacement) return;

    const successfulRebuildBlock = innermostBlockContaining(
      editorSource,
      replacement.index,
    );

    expect({
      releaseApproved: /setReleaseApproved\(\s*false\s*\)/.test(
        successfulRebuildBlock,
      ),
      authorApproved: /setAuthorApproved\(\s*false\s*\)/.test(
        successfulRebuildBlock,
      ),
    }).toEqual({
      releaseApproved: true,
      authorApproved: true,
    });
  });
});
