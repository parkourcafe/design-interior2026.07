import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const runner = () => readFileSync("tests/pilot-evidence/executors/external-package-runner.zsh", "utf8");
const block = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end));
const submittedCommandId = "90000000-0000-4000-8000-000000000001";
const databaseCommandId = "90000000-0000-4000-8000-000000000002";
const httpRequestId = "90000000-0000-4000-8000-000000000003";
const auditRequestId = "90000000-0000-4000-8000-000000000004";
const auditEventId = "90000000-0000-4000-8000-000000000005";
const ownerUserId = "90000000-0000-4000-8000-000000000006";
const organizationId = "90000000-0000-4000-8000-000000000007";
const projectId = "90000000-0000-4000-8000-000000000008";
const approvedDatabaseCommandId = "90000000-0000-4000-8000-000000000009";

function runMockedSend(logicalResult = '{"accepted":true}') {
  const root = mkdtempSync(join(tmpdir(), "external-runner-audit-"));
  const script = join(root, "runner.zsh");
  const send = block(runner(), "send_command()", "# `review_m2_client_submission(approved)`");
  writeFileSync(script, `#!/bin/zsh
set -euo pipefail
work_dir=${root}
commands_file="${root}/commands.json"
sessions_file="${root}/sessions.json"
organization_id=${organizationId}
project_id=${projectId}
stage=initialized
print -r -- '[]' > "${root}/commands.json"
print -r -- '[{"role":"owner_lead","userId":"${ownerUserId}","sessionId":"session-1","serverSessionDigest":"sha256:session"}]' > "${root}/sessions.json"
post_command() {
  local output=$3
  if [[ $output == *-replay.json ]]; then
    print -r -- '{"status":"completed","replay":true,"requestId":"${httpRequestId}","stateRevision":42,"result":{"accepted":true}}' > "$output"
  else
    print -r -- '{"status":"completed","replay":false,"requestId":"${httpRequestId}","stateRevision":42,"result":{"accepted":true}}' > "$output"
  fi
}
harvest_db_command() {
  print -r -- '{"commandId":"${databaseCommandId}","organizationId":"${organizationId}","projectId":"${projectId}","actorUserId":"${ownerUserId}","requestId":"${auditRequestId}","resultingStateRevision":42,"logicalResult":${logicalResult},"auditEventId":"${auditEventId}"}'
}
${send}
send_command owner submit_m2_client_review '{}' '${submittedCommandId}'
`);
  const result = spawnSync("zsh", [script], { encoding: "utf8" });
  const receipt = readFileSync(join(root, "commands.json"), "utf8");
  rmSync(root, { recursive: true, force: true });
  return { result, receipt };
}

function runMockedApprovedCommitSideEffect() {
  const root = mkdtempSync(join(tmpdir(), "external-runner-approved-"));
  const script = join(root, "runner.zsh");
  const sideEffect = block(runner(), "record_approved_commit_side_effect()", "# Five request-bound sessions");
  writeFileSync(script, `#!/bin/zsh
set -euo pipefail
uuid_pattern='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
work_dir=${root}
commands_file="${root}/commands.json"
sessions_file="${root}/sessions.json"
organization_id=${organizationId}
project_id=${projectId}
print -r -- '[{"operation":"review_m2_client_submission","commandId":"${databaseCommandId}","submittedCommandId":"${submittedCommandId}","requestId":"${httpRequestId}"}]' > "${root}/commands.json"
print -r -- '[{"role":"client_approver","userId":"${ownerUserId}","sessionId":"session-2","serverSessionDigest":"sha256:session"}]' > "${root}/sessions.json"
harvest_db_command() {
  print -r -- "$1|$2|$3" > "${root}/harvest-args"
  print -r -- '{"commandId":"${approvedDatabaseCommandId}","organizationId":"${organizationId}","projectId":"${projectId}","actorUserId":"${ownerUserId}","requestId":"${auditRequestId}","resultingStateRevision":43,"logicalResult":{"approved":true},"auditEventId":"${auditEventId}"}'
}
${sideEffect}
record_approved_commit_side_effect
`);
  const result = spawnSync("zsh", [script], { encoding: "utf8" });
  const receipt = readFileSync(join(root, "commands.json"), "utf8");
  const harvestArgs = readFileSync(join(root, "harvest-args"), "utf8");
  rmSync(root, { recursive: true, force: true });
  return { result, receipt, harvestArgs };
}

function runMockedReviewPrerequisites(submissionId: string, variantId: string) {
  const root = mkdtempSync(join(tmpdir(), "external-runner-sql-binding-"));
  const bin = join(root, "bin");
  const script = join(root, "runner.zsh");
  const docker = join(bin, "docker");
  const argsFile = join(root, "docker-args");
  const sqlFile = join(root, "query.sql");
  mkdirSync(bin);
  writeFileSync(docker, `#!/bin/zsh
set -euo pipefail
: > "${argsFile}"
for arg in "$@"; do
  print -rn -- "$arg" | openssl base64 -A >> "${argsFile}"
  print >> "${argsFile}"
done
cat > "${sqlFile}"
print -r -- '{"submissionPresent":true,"submissionRevisionCurrent":true,"assignedClientDistinct":true,"approvalPackageRequired":true,"chosenVariantPresent":true,"chosenBudgetClean":true}'
`);
  chmodSync(docker, 0o700);
  const queryDb = block(runner(), "query_db()", "session_digest()");
  const reviewPrerequisites = block(runner(), "submission_id=$(manifest_jq", "review_command_id=$(uuidgen");
  const encodedSubmissionId = Buffer.from(submissionId).toString("base64");
  const encodedVariantId = Buffer.from(variantId).toString("base64");
  writeFileSync(script, `#!/bin/zsh
set -euo pipefail
db_container=mock-db
project_id=${projectId}
manifest_jq() {
  case "${'${@: -1}'}" in
    '.m2.submissionId') print -rn -- '${encodedSubmissionId}' | openssl base64 -d -A ;;
    '.m2.submissionRevisionId') print -rn -- '90000000-0000-4000-8000-000000000010' ;;
    '.m2.variants[0].variantId') print -rn -- '${encodedVariantId}' | openssl base64 -d -A ;;
    *) return 64 ;;
  esac
}
${queryDb}
${reviewPrerequisites}
`);
  const result = spawnSync("zsh", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
  });
  const args = readFileSync(argsFile, "utf8").trimEnd().split("\n")
    .map((value) => Buffer.from(value, "base64").toString());
  const sql = readFileSync(sqlFile, "utf8");
  rmSync(root, { recursive: true, force: true });
  return { result, args, sql };
}

describe("external package runner audit-command binding", () => {
  it("binds each direct harvest to the persisted digest of its minted UI idempotency key", () => {
    const source = runner();
    const harvest = block(source, "harvest_db_command()", "# One authenticated POST");
    expect(harvest).toContain("local operation=$1 command_id=$2 key_suffix=${3:-}");
    expect(harvest).toContain("[[ ${command_id} =~ ${~uuid_pattern} ]]");
    expect(harvest).toContain('expected_key="ui:${project_id}:${idempotency_kind}:${command_id}${key_suffix}"');
    expect(harvest).toContain("expected_key_digest=$(print -rn -- \"${expected_key}\" | shasum -a 256");
    expect(harvest).toContain("encode(command.key_digest, 'hex') = '${expected_key_digest}'");
    expect(harvest).toContain("audit.command_id = command.command_id");
    expect(harvest).not.toMatch(/order by|limit 1/i);
  });

  it("does not replace the HTTP command ID and verifies the response, actor, and scope against that bound record", () => {
    const source = runner();
    const send = block(source, "send_command()", "# `review_m2_client_submission(approved)`");
    expect(send).toContain('harvest_db_command "${operation}" "${command_id}"');
    expect(send).toContain("EXTERNAL_RUNNER_DB_RESPONSE_MISMATCH");
    expect(send).toContain("EXTERNAL_RUNNER_DB_COMMAND_SCOPE_MISMATCH");
    expect(send).toContain(".result == $record.logicalResult");
    expect(send).toContain('submittedCommandId: $submittedCommandId');
  });

  it("binds the atomic approved commit to the parent review key plus its migration-defined suffix", () => {
    const source = runner();
    const sideEffect = block(source, "record_approved_commit_side_effect()", "# Five request-bound sessions");
    expect(sideEffect).toContain('parent_command_id=$(jq -er \'.[] | select(.operation == "review_m2_client_submission") | .submittedCommandId\'');
    expect(sideEffect).toContain('harvest_db_command "${operation}" "${parent_command_id}" \':approved-commit\'');
    expect(sideEffect).toContain("EXTERNAL_RUNNER_APPROVED_COMMIT_SCOPE_MISMATCH");
  });

  it("accepts a bound DB record whose command and audit IDs differ from the HTTP IDs", () => {
    const { result, receipt } = runMockedSend();
    expect(result.status).toBe(0);
    const commands = JSON.parse(receipt);
    expect(commands).toEqual([expect.objectContaining({
      commandId: databaseCommandId,
      submittedCommandId,
      requestId: httpRequestId,
      auditRequestId,
    })]);
    expect(commands.map((command: { commandId: string }) => command.commandId)).toEqual([databaseCommandId]);
  });

  it("fails closed when the bound record's logical result does not match the HTTP response", () => {
    const { result } = runMockedSend('{"accepted":false}');
    expect(result.status).toBe(68);
    expect(result.stderr).toContain("EXTERNAL_RUNNER_DB_RESPONSE_MISMATCH operation=submit_m2_client_review phase=first");
  });

  it("keeps the DB command ID for audit-proof consumers while binding the atomic side effect to the submitted parent ID", () => {
    const { result, receipt, harvestArgs } = runMockedApprovedCommitSideEffect();
    expect(result.status).toBe(0);
    expect(harvestArgs.trim()).toBe(`append_m2_approved_commit_revision|${submittedCommandId}|:approved-commit`);
    expect(JSON.parse(receipt)[1]).toMatchObject({
      commandId: approvedDatabaseCommandId,
      submittedCommandId,
    });
  });

  it.each([
    {
      name: "ordinary identifiers",
      submissionId: "submission-control-1",
      variantId: "variant-control-1",
    },
    {
      name: "apostrophes, SQL-like text, shell metacharacters, newlines, and backslashes",
      submissionId: "client's submission'; select pg_sleep(1); --\nnext\\row",
      variantId: "variant $(touch /tmp/never) | & < > `never`\nquoted'\\tail",
    },
  ])("transports $name as psql variables without rendering them into SQL", ({ submissionId, variantId }) => {
    const { result, args, sql } = runMockedReviewPrerequisites(submissionId, variantId);
    expect(result.status).toBe(0);
    expect(args).toEqual([
      "exec", "-i", "mock-db", "psql", "-X", "-qAt", "--set", "ON_ERROR_STOP=1",
      "--username", "postgres", "--dbname", "postgres",
      "--set", `project_id=${projectId}`,
      "--set", `submission_id=${submissionId}`,
      "--set", "submission_revision_id=90000000-0000-4000-8000-000000000010",
      "--set", `chosen_variant_id=${variantId}`,
    ]);
    expect(sql.match(/:'project_id'/g)).toHaveLength(6);
    expect(sql.match(/:'submission_id'/g)).toHaveLength(6);
    expect(sql.match(/:'submission_revision_id'/g)).toHaveLength(1);
    expect(sql.match(/:'chosen_variant_id'/g)).toHaveLength(2);
    expect(sql).not.toContain(submissionId);
    expect(sql).not.toContain(variantId);
  });
});
