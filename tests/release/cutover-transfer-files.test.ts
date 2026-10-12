import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { execFile, type ExecFileException } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ТЗ 08.10, FIX-02: перенос файлов клиентов проверяется по содержимому, а не по
// размеру. Скрипт запускается целиком против поддельного Storage API двух
// проектов (только синтетические файлы); проверяется его код выхода, вывод и
// то, что лежит в приёмнике после запуска.

const SCRIPT = resolve(__dirname, "../../scripts/cutover/transfer-files.mjs");
const BUCKET = "client-uploads";

type Store = Map<string, Buffer>;

interface Fake {
  source: Store;
  target: Store;
  /** Сбои по ключу «сторона:метод:путь» — сколько раз ответить 500. */
  failures: Map<string, number>;
  url: string;
  server: Server;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

function listLevel(store: Store, prefix: string) {
  const base = prefix ? `${prefix}/` : "";
  const files = new Map<string, Buffer>();
  const folders = new Set<string>();
  for (const [path, bytes] of store) {
    if (!path.startsWith(base)) continue;
    const rest = path.slice(base.length);
    const slash = rest.indexOf("/");
    if (slash === -1) files.set(rest, bytes);
    else folders.add(rest.slice(0, slash));
  }
  return [
    ...[...folders].sort().map((name) => ({ name, id: null, metadata: null })),
    ...[...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => ({
      name, id: `id-${name}`, metadata: { size: bytes.length, mimetype: "application/pdf" },
    })),
  ];
}

async function startFake(): Promise<Fake> {
  const fake = { source: new Map(), target: new Map(), failures: new Map() } as unknown as Fake;
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    const [, side, ...rest] = url.pathname.split("/");
    const store = side === "src" ? fake.source : fake.target;
    const path = "/" + rest.join("/");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const fail = (key: string) => {
      const left = fake.failures.get(key) ?? 0;
      if (left > 0) { fake.failures.set(key, left - 1); return true; }
      return false;
    };
    if (req.method === "POST" && path === `/storage/v1/object/list/${BUCKET}`) {
      const body = JSON.parse((await readBody(req)).toString() || "{}") as { prefix?: string; offset?: number };
      const all = listLevel(store, body.prefix ?? "");
      return send(200, all.slice(body.offset ?? 0, (body.offset ?? 0) + 1000));
    }
    const objectPrefix = `/storage/v1/object/${BUCKET}/`;
    if (!path.startsWith(objectPrefix)) return send(404, { error: "not found" });
    const key = path.slice(objectPrefix.length).split("/").map(decodeURIComponent).join("/");
    if (req.method === "GET") {
      if (fail(`${side}:GET:${key}`)) return send(500, { error: "boom" });
      const bytes = store.get(key);
      if (!bytes) return send(404, { error: "not found" });
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(bytes);
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (fail(`${side}:POST:${key}`)) return send(500, { error: "boom" });
      if (fail(`${side}:POST400:${key}`)) return send(400, { statusCode: "400", error: "InvalidMimeType", message: "mime type not supported" });
      if (fail(`${side}:POSTDUP400:${key}`)) { store.set(key, body); return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" }); }
      if (store.has(key)) return send(409, { statusCode: "409", error: "Duplicate" });
      store.set(key, body);
      return send(200, { Key: `${BUCKET}/${key}` });
    }
    return send(405, { error: "method" });
  };
  fake.server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((ok) => fake.server.listen(0, "127.0.0.1", ok));
  const address = fake.server.address();
  fake.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return fake;
}

function run(fake: Fake, extra: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((ok) => {
    execFile(process.execPath, [SCRIPT], {
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "test",
        SOURCE_SUPABASE_URL: `${fake.url}/src`, SOURCE_SERVICE_ROLE_KEY: "synthetic-source-key",
        TARGET_SUPABASE_URL: `${fake.url}/tgt`, TARGET_SERVICE_ROLE_KEY: "synthetic-target-key",
        ...extra,
      },
    }, (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      ok({ code, out: `${stdout.toString()}${stderr.toString()}` });
    });
  });
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const synthetic = (label: string, size = 64) => Buffer.from(label.padEnd(size, "."));

let fake: Fake;
beforeEach(async () => {
  fake = await startFake();
  fake.source.set("p1/plan.pdf", synthetic("SYNTHETIC plan A"));
  fake.source.set("designer-plans/p1/sheet.pdf", synthetic("SYNTHETIC sheet B", 128));
});
afterEach(async () => { await new Promise((ok) => fake.server.close(ok)); });

describe("cutover transfer-files (FIX-02)", () => {
  it("copies everything into an empty target and verifies bytes", async () => {
    const r = await run(fake, { EXPECTED_FILE_COUNT: "2" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("FILES_TRANSFER_OK");
    for (const [path, bytes] of fake.source) expect(sha(fake.target.get(path)!)).toBe(sha(bytes));
  });

  it("skips an identical existing file after comparing content", async () => {
    fake.target.set("p1/plan.pdf", Buffer.from(fake.source.get("p1/plan.pdf")!));
    const r = await run(fake);
    expect(r.code).toBe(0);
    expect(r.out).toContain("FILES_TRANSFER_OK");
  });

  it("fails on a different size and leaves the target file untouched", async () => {
    const other = synthetic("SYNTHETIC other", 80);
    fake.target.set("p1/plan.pdf", other);
    const r = await run(fake);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain("FILES_TRANSFER_OK");
    expect(fake.target.get("p1/plan.pdf")).toEqual(other);
  });

  it("fails on the same size with different content and does not overwrite", async () => {
    const original = fake.source.get("p1/plan.pdf")!;
    const forged = synthetic("SYNTHETIC forged", original.length);
    expect(forged.length).toBe(original.length);
    fake.target.set("p1/plan.pdf", forged);
    const r = await run(fake);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain("FILES_TRANSFER_OK");
    expect(r.out).toContain("p1/plan.pdf");
    expect(fake.target.get("p1/plan.pdf")).toEqual(forged);
  });

  it("survives an interrupted run: the rerun completes without overwriting", async () => {
    fake.failures.set("tgt:POST:p1/plan.pdf", 1);
    const first = await run(fake);
    expect(first.code).not.toBe(0);
    expect(first.out).not.toContain("FILES_TRANSFER_OK");
    const second = await run(fake);
    expect(second.code).toBe(0);
    expect(second.out).toContain("FILES_TRANSFER_OK");
    for (const [path, bytes] of fake.source) expect(sha(fake.target.get(path)!)).toBe(sha(bytes));
  });

  it("fails when a source file cannot be read", async () => {
    fake.failures.set("src:GET:p1/plan.pdf", 5);
    const r = await run(fake);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain("FILES_TRANSFER_OK");
  });

  it("fails when the target copy cannot be read back for verification", async () => {
    fake.target.set("p1/plan.pdf", Buffer.from(fake.source.get("p1/plan.pdf")!));
    fake.failures.set("tgt:GET:p1/plan.pdf", 5);
    const r = await run(fake);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain("FILES_TRANSFER_OK");
  });

  it("reports a non-duplicate upload rejection as an upload error, not as an existing file", async () => {
    fake.failures.set("tgt:POST400:p1/plan.pdf", 1);
    const r = await run(fake);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("upload p1/plan.pdf: HTTP 400");
    expect(r.out).toContain("InvalidMimeType");
    expect(r.out).not.toContain("FILES_TRANSFER_OK");
  });

  it("treats a 400 with a Duplicate body as an existing file and verifies it", async () => {
    fake.failures.set("tgt:POSTDUP400:p1/plan.pdf", 1);
    const r = await run(fake);
    expect(r.code).toBe(0);
    expect(r.out).toContain("FILES_TRANSFER_OK");
    expect(sha(fake.target.get("p1/plan.pdf")!)).toBe(sha(fake.source.get("p1/plan.pdf")!));
  });

  it("still refuses when the Storage list disagrees with the database count", async () => {
    const r = await run(fake, { EXPECTED_FILE_COUNT: "3" });
    expect(r.code).not.toBe(0);
    expect(fake.target.size).toBe(0);
  });
});
