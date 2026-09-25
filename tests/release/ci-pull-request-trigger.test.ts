import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DEC-040 (25.09.2026): CI обязателен на каждом PR. 18.09 автоматический
// прогон был отключён одной правкой workflow (07e186d) — и на слияниях
// #205–#209 не исполнился ни один гейт. Этот тест делает такое отключение
// видимым: убрать pull_request из ci.yml можно только вместе с этим тестом.

const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

function triggerBlock(source: string): string {
  const start = source.search(/^on:\s*$/m);
  if (start < 0) throw new Error("ci.yml has no top-level on: block");
  const rest = source.slice(start).split("\n").slice(1);
  const lines: string[] = [];
  for (const line of rest) {
    if (/^\S/.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n");
}

function jobBlock(source: string, job: string): string {
  const match = source.match(new RegExp(`^  ${job}:\\s*$([\\s\\S]*?)(?=^  [a-z0-9_-]+:\\s*$|(?![\\s\\S]))`, "m"));
  if (!match?.[1]) throw new Error(`job ${job} missing from ci.yml`);
  return match[1];
}

describe("CI runs on every pull request", () => {
  it("keeps the pull_request trigger for opened, synchronize and reopened", () => {
    const on = triggerBlock(workflow);
    expect(on).toMatch(/^ {2}pull_request:\s*$/m);
    expect(on).toMatch(/types:\s*\[\s*opened,\s*synchronize,\s*reopened\s*\]/);
  });

  it("does not gate the blocking jobs on the triggering event", () => {
    for (const job of ["scope", "gates", "database", "execution_database", "ap5"]) {
      const block = jobBlock(workflow, job);
      // Job-level if (4 пробела) не должен зависеть от github.event_name —
      // иначе job можно тихо выключить для pull_request.
      const jobIf = block.split("\n").filter((line) => /^ {4}if:/.test(line)).join("\n");
      expect(jobIf, job).not.toMatch(/event_name|workflow_dispatch|pull_request/);
    }
  });
});
