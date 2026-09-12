import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, writeSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const TARGET = "reitdpzxtnmdkznesffu";
const ZERO = "0".repeat(64);
const DIGEST = /^[a-f0-9]{64}$/;
const OID = /^[a-f0-9]{40}$/;
const TERMINAL = new Set(["FAILED", "UNCERTAIN", "SUCCEEDED"]);
const FAILURES = new Set(["ARM_REJECTED", "ARM_UNCERTAIN", "DB_ERROR", "ACK_UNCERTAIN", "POSTCHECK_ERROR", "JOURNAL_ERROR", "PROCESS_INTERRUPTED"]);
const PINS = Object.freeze({
  sourceCommit: "d5f21817f34f336e10c562a3515d5004711d25e5",
  manifestSha256: "bf772ca1d8253160310ea442068e49295dd172503f837fbf689a9f9fd6d10230",
  ledgerSha256: "9bc7e7b4efffffed76e69840393ada020eee156a61a769635cb4d2d2180e36ab",
  ownerCommandSha256: "3a951ba65a3ca0a67cde206a5fe0ee2204ef5cc41dfcf3c0d4d1f5fe7127e3c3",
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error(`CLONE_JOURNAL_${code}`); };
const keysExactly = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === keys.sort().join(",");
function snapshot(value) {
  try { return structuredClone(value); } catch { fail("INPUT_INVALID"); }
}
function closePrivate(fd) {
  try { closeSync(fd); } catch { fail("CLOSE_UNCERTAIN"); }
}

function validateBinding(binding) {
  if (!keysExactly(binding, ["targetRef", "runId", ...Object.keys(PINS), "planSha256", "executorSha256", "fingerprintSha256", "historySha256", "auxiliarySha256"])) fail("BINDING_INVALID");
  if (Object.values(binding).some((value) => typeof value !== "string")) fail("BINDING_INVALID");
  if (binding.targetRef !== TARGET || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(binding.runId)) fail("BINDING_INVALID");
  for (const [key, expected] of Object.entries(PINS)) if (binding[key] !== expected) fail("PIN_MISMATCH");
  for (const key of ["planSha256", "executorSha256", "fingerprintSha256", "historySha256", "auxiliarySha256"]) if (!DIGEST.test(binding[key])) fail("BINDING_INVALID");
}

function privateFile(stat) {
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid() || stat.nlink !== 1) fail("FILE_UNSAFE");
}

function nextState(previous, event) {
  if (!keysExactly(event, ["state", "step", "remoteCommit", "failure"])) fail("EVENT_INVALID");
  if (TERMINAL.has(previous.state)) fail("TERMINAL");
  if (event.remoteCommit !== null && (typeof event.remoteCommit !== "string" || !OID.test(event.remoteCommit))) fail("EVENT_INVALID");
  if (event.failure !== null && !FAILURES.has(event.failure)) fail("EVENT_INVALID");
  if (!Number.isInteger(event.step) || event.step < 0 || event.step > 97) fail("EVENT_INVALID");
  if (event.state === "FAILED" || event.state === "UNCERTAIN") {
    if (!event.failure || event.step !== previous.step) fail("EVENT_INVALID");
    return;
  }
  if (event.failure !== null) fail("EVENT_INVALID");
  if (event.state === "ARMED" && previous.state === "ARM_INTENT" && event.step === 0 && event.remoteCommit) return;
  if (event.state === "STAGED" && ["ARMED", "STAGED"].includes(previous.state) && event.step === previous.step + 1 && event.remoteCommit === null) return;
  if (event.state === "COMMIT_INTENT" && previous.state === "STAGED" && previous.step === 97 && event.step === 97 && event.remoteCommit === null) return;
  if (event.state === "SUCCEEDED" && previous.state === "COMMIT_INTENT" && event.step === 97 && event.remoteCommit === null) return;
  fail("TRANSITION_INVALID");
}

function encode(body, previousDigest) {
  const payload = { ...body, previousDigest };
  return { ...payload, digest: hash(JSON.stringify(payload)) };
}

// Supplemental local evidence only. The independent remote absence-CAS fence is
// still required before SQL; a hash-bound journal is not consent or live proof.
export function createCloneRunJournal({ directory, binding }) {
  const pinnedBinding = snapshot(binding);
  validateBinding(pinnedBinding);
  if (typeof directory !== "string" || !isAbsolute(directory)) fail("DIRECTORY_INVALID");
  let dirStat;
  try { dirStat = lstatSync(directory); } catch { fail("DIRECTORY_UNAVAILABLE"); }
  if (!dirStat.isDirectory() || (dirStat.mode & 0o777) !== 0o700 || dirStat.uid !== process.getuid()) fail("DIRECTORY_UNSAFE");
  const path = join(directory, `${TARGET}.jsonl`);
  let fd;
  try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { fail("EXISTS_OR_UNAVAILABLE"); }
  let closed = false;
  let poisoned = false;
  let bytes = 0;
  let current = null;
  let identity;
  try { identity = fstatSync(fd); }
  catch { try { closePrivate(fd); } catch { /* Keep the original fixed failure classification. */ } fail("CREATE_UNCERTAIN"); }
  function persist(body) {
    if (closed || poisoned) fail("UNAVAILABLE");
    try {
      const stat = fstatSync(fd);
      const linked = lstatSync(path);
      privateFile(stat); privateFile(linked);
      if (stat.ino !== identity.ino || stat.dev !== identity.dev || linked.ino !== stat.ino || linked.dev !== stat.dev || stat.size !== bytes) fail("FILE_CHANGED");
      const record = encode(body, current?.digest ?? ZERO);
      const line = Buffer.from(`${JSON.stringify(record)}\n`);
      let written = 0;
      while (written < line.length) {
        const count = writeSync(fd, line, written, line.length - written, bytes + written);
        if (count <= 0) fail("WRITE_FAILED");
        written += count;
      }
      fsyncSync(fd);
      bytes += line.length;
      current = record;
    } catch {
      poisoned = true;
      fail("WRITE_UNCERTAIN");
    }
  }
  try {
    persist({ sequence: 0, state: "ARM_INTENT", step: 0, binding: pinnedBinding });
    const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const actual = fstatSync(directoryFd);
      if (actual.ino !== dirStat.ino || actual.dev !== dirStat.dev) fail("DIRECTORY_CHANGED");
      fsyncSync(directoryFd);
    } finally { closePrivate(directoryFd); }
  } catch {
    try { closePrivate(fd); } catch { /* Existing journal remains a refusal fence. */ }
    fail("CREATE_UNCERTAIN");
  }
  return Object.freeze({
    path,
    append(event) {
      const pinnedEvent = snapshot(event);
      nextState(current, pinnedEvent);
      persist({ sequence: current.sequence + 1, ...pinnedEvent });
    },
    close() { if (!closed) { closed = true; closePrivate(fd); } },
  });
}

export function inspectCloneRunJournal(path) {
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { fail("READ_UNAVAILABLE"); }
  try {
    const stat = fstatSync(fd);
    privateFile(stat);
    if (stat.size < 1 || stat.size > 131072) fail("CORRUPT");
    const buffer = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const amount = readSync(fd, buffer, count, buffer.length - count, count);
      if (amount === 0) break;
      count += amount;
    }
    const bytes = buffer.subarray(0, count);
    if (bytes.length !== stat.size || !bytes.toString("utf8").endsWith("\n")) fail("UNCERTAIN");
    const records = bytes.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    let previous;
    for (const [index, record] of records.entries()) {
      const expectedKeys = index === 0 ? ["sequence", "state", "step", "binding", "previousDigest", "digest"] : ["sequence", "state", "step", "remoteCommit", "failure", "previousDigest", "digest"];
      if (!keysExactly(record, expectedKeys) || record.sequence !== index) fail("CORRUPT");
      const { digest, ...body } = record;
      if (record.previousDigest !== (previous?.digest ?? ZERO) || digest !== hash(JSON.stringify(body))) fail("CORRUPT");
      if (index === 0) {
        validateBinding(record.binding);
        if (record.state !== "ARM_INTENT" || record.step !== 0) fail("CORRUPT");
      } else nextState(previous, { state: record.state, step: record.step, remoteCommit: record.remoteCommit, failure: record.failure });
      previous = record;
    }
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) fail("UNCERTAIN");
    return { evidenceClass: "LOCAL_JOURNAL", resumeAllowed: false, lastState: previous.state, stagedCount: previous.step, binding: records[0].binding, records };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CLONE_JOURNAL_")) throw error;
    fail("CORRUPT");
  } finally { closePrivate(fd); }
}
