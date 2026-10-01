import { beforeEach, describe, expect, it, vi } from "vitest";

// Аудит 28.09, шаг 5: ограничения загрузки файлов клиента. Маршрут выполняется
// целиком; база и хранилище подменены (mock) — атомарность лимита в самой базе
// проверяет DB4 (87_intake_limits_and_consent.sql).

const state = vi.hoisted(() => ({
  existing: [] as unknown[],
  appendResult: { ok: true, count: 1 } as unknown,
  appendError: null as null | { message: string },
  uploads: [] as { path: string; contentType: string }[],
  removed: [] as string[][],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  allowed: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/intake", () => ({
  getProjectByIntakeToken: async () => ({
    id: "11111111-1111-4111-8111-111111111111", designer_id: "designer", status: "brief_in_progress",
    cellCode: "ru", custom_questions: [],
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => state.allowed, clientIp: () => "test" }));
vi.mock("@/lib/supabase/regional-admin", () => ({
  createRegionalPublicTokenClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return { data: state.appendResult, error: state.appendError };
    },
    storage: {
      from: () => ({
        upload: async (path: string, _body: unknown, options: { contentType: string }) => {
          state.uploads.push({ path, contentType: options.contentType });
          return { error: null };
        },
        remove: async (paths: string[]) => { state.removed.push(paths); return { error: null }; },
      }),
    },
    from: () => {
      const query = {
        select: () => query, eq: () => query, maybeSingle: () => query,
        insert: async () => ({ error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: { value: state.existing }, error: null }).then(resolve),
      };
      return query;
    },
  }),
}));

import { POST as upload } from "../../app/api/intake/upload/route";
import { clientFileDisplayName, safeClientFileName, sniffClientUpload } from "../../lib/brief/client-upload-policy";

const PDF = "%PDF-1.7 synthetic";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function uploadRequest(file: File) {
  const form = new FormData();
  form.set("token", "token");
  form.set("file", file);
  return new Request("http://localhost/api/intake/upload", { method: "POST", body: form });
}

beforeEach(() => {
  state.existing = [];
  state.appendResult = { ok: true, count: 1 };
  state.appendError = null;
  state.uploads = [];
  state.removed = [];
  state.rpcCalls = [];
  state.allowed = true;
});

describe("client upload policy", () => {
  it("detects the type from the bytes, not the name", () => {
    expect(sniffClientUpload(new TextEncoder().encode(PDF))?.mediaType).toBe("application/pdf");
    expect(sniffClientUpload(PNG)?.mediaType).toBe("image/png");
    expect(sniffClientUpload(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("strips paths and control characters from the file name", () => {
    // Ключ хранилища — только ASCII: Supabase Storage отвергает кириллицу
    // (проверено на стенде 28.09: «План.png» → 500 до исправления).
    expect(safeClientFileName("../../other-project/план кухни.PDF", "pdf")).toBe("other-project_plan_kuhni.pdf");
    expect(safeClientFileName("План Ёлки.png", "png")).toBe("Plan_Elki.png");
    expect(safeClientFileName("日本.webp", "webp")).toBe("file.webp");
    expect(clientFileDisplayName("C:\\Users\\a\\План квартиры.pdf")).toBe("План квартиры.pdf");
    expect(clientFileDisplayName("../../x\u0000y.png")).toBe("xy.png");
    expect(safeClientFileName("", "png")).toBe("file.png");
  });
});

describe("intake upload route limits", () => {
  it("stores an accepted PDF under the project folder with a sniffed type", async () => {
    const response = await upload(uploadRequest(new File([PDF], "../../evil.exe")));
    expect(response.status).toBe(200);
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0]?.path).toMatch(/^11111111-1111-4111-8111-111111111111\/\d+-evil\.pdf$/);
    expect(state.uploads[0]?.contentType).toBe("application/pdf");
    expect(state.rpcCalls[0]?.name).toBe("append_intake_attachment");
    expect(state.rpcCalls[0]?.args.p_max_files).toBe(10);
  });

  it("rejects a file that is not a plan or photo before storing it", async () => {
    const response = await upload(uploadRequest(new File(["<script>"], "plan.pdf", { type: "application/pdf" })));
    expect(response.status).toBe(415);
    expect(state.uploads).toEqual([]);
  });

  it("rejects an oversized file before storing it", async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode(PDF));
    const response = await upload(uploadRequest(new File([big], "big.pdf")));
    expect(response.status).toBe(413);
    expect(state.uploads).toEqual([]);
  });

  it("refuses the eleventh file before storing it", async () => {
    state.existing = Array.from({ length: 10 }, (_, i) => ({ path: `p/${i}` }));
    const response = await upload(uploadRequest(new File([PDF], "plan.pdf")));
    expect(response.status).toBe(409);
    expect(state.uploads).toEqual([]);
  });

  it("removes the stored object when the database refuses the attachment (race)", async () => {
    state.appendResult = { ok: false, reason: "too_many_files" };
    const response = await upload(uploadRequest(new File([PDF], "plan.pdf")));
    expect(response.status).toBe(409);
    expect(state.removed).toEqual([[state.uploads[0]?.path]]);
  });

  it("removes the stored object when writing metadata fails", async () => {
    state.appendError = { message: "db down" };
    const response = await upload(uploadRequest(new File([PDF], "plan.pdf")));
    expect(response.status).toBe(500);
    expect(state.removed).toEqual([[state.uploads[0]?.path]]);
  });

  it("is rate limited", async () => {
    state.allowed = false;
    expect((await upload(uploadRequest(new File([PDF], "plan.pdf")))).status).toBe(429);
    expect(state.uploads).toEqual([]);
  });
});
