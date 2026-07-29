import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const answerQuery = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  answerQuery.eq.mockReturnValue(answerQuery);

  const answerUpsert = vi.fn().mockResolvedValue({ error: null });
  const storageUpload = vi.fn().mockResolvedValue({ error: null });
  const storageRemove = vi.fn().mockResolvedValue({ error: null });
  const admin = {
    from: vi.fn((table: string) => {
      if (table !== "answers") throw new Error(`unexpected table: ${table}`);
      return {
        select: vi.fn(() => answerQuery),
        upsert: answerUpsert,
      };
    }),
    storage: {
      from: vi.fn((bucket: string) => {
        if (bucket !== "client-uploads") {
          throw new Error(`unexpected bucket: ${bucket}`);
        }
        return {
          upload: storageUpload,
          remove: storageRemove,
        };
      }),
    },
  };

  return {
    admin,
    answerQuery,
    answerUpsert,
    createAdminClient: vi.fn(() => admin),
    getProject: vi.fn(),
    storageUpload,
    storageRemove,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/intake", () => ({
  getProjectByIntakeToken: mocks.getProject,
}));

import { POST as uploadClientFile } from "@/app/api/intake/upload/route";
import { isProjectClientUploadPath } from "@/lib/storage/client-upload";

const CLIENT_UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024;
const CLIENT_UPLOAD_MAX_REQUEST_BYTES =
  CLIENT_UPLOAD_MAX_FILE_BYTES + 64 * 1024;

const project = {
  id: "00000000-0000-4000-8000-000000000111",
  designer_id: "00000000-0000-4000-8000-000000000222",
  client_name: "Клиент",
  status: "brief_in_progress",
  custom_questions: [],
};

function multipartRequest(file: File, token = "valid-intake-token"): Request {
  const form = new FormData();
  form.append("token", token);
  form.append("file", file);
  return new Request("http://localhost/api/intake/upload", {
    method: "POST",
    body: form,
  });
}

describe("client intake upload security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.answerQuery.eq.mockReturnValue(mocks.answerQuery);
    mocks.answerQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.answerUpsert.mockResolvedValue({ error: null });
    mocks.storageUpload.mockResolvedValue({ error: null });
    mocks.storageRemove.mockResolvedValue({ error: null });
    mocks.getProject.mockResolvedValue(project);
  });

  it("rejects an oversized declared request before token or storage access", async () => {
    const response = await uploadClientFile(
      new Request("http://localhost/api/intake/upload", {
        method: "POST",
        headers: {
          "content-length": String(CLIENT_UPLOAD_MAX_REQUEST_BYTES + 1),
          "content-type": "multipart/form-data; boundary=not-read",
        },
        body: "--not-read--",
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("bounds a streamed request even when Content-Length is absent", async () => {
    const oversizedChunk = new Uint8Array(CLIENT_UPLOAD_MAX_REQUEST_BYTES + 1);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversizedChunk);
        controller.close();
      },
    });
    const response = await uploadClientFile(
      new Request("http://localhost/api/intake/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=streamed" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
    expect(mocks.getProject).not.toHaveBeenCalled();
  });

  it("rejects ownerless tokens and disallowed active content before storage", async () => {
    mocks.getProject.mockResolvedValueOnce({ ...project, designer_id: null });
    const ownerless = await uploadClientFile(
      multipartRequest(new File(["image"], "plan.png", { type: "image/png" })),
    );

    expect(ownerless.status).toBe(409);
    expect(await ownerless.json()).toEqual({ error: "intake_owner_required" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();

    mocks.getProject.mockResolvedValueOnce(project);
    const svg = await uploadClientFile(
      multipartRequest(
        new File(["<svg onload=alert(1)>"], "plan.svg", {
          type: "image/svg+xml",
        }),
      ),
    );

    expect(svg.status).toBe(415);
    expect(await svg.json()).toEqual({ error: "unsupported_file_type" });
    expect(mocks.storageUpload).not.toHaveBeenCalled();
  });

  it("rejects oversized intake tokens before database lookup", async () => {
    const response = await uploadClientFile(
      multipartRequest(
        new File(["image"], "plan.png", { type: "image/png" }),
        `token-${"x".repeat(256)}`,
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("enforces the file limit independently of multipart request overhead", async () => {
    const file = new File(
      [new Uint8Array(CLIENT_UPLOAD_MAX_FILE_BYTES + 1)],
      "large.pdf",
      { type: "application/pdf" },
    );
    const response = await uploadClientFile(multipartRequest(file));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "file_too_large" });
    expect(mocks.storageUpload).not.toHaveBeenCalled();
  });

  it("uses a generated project-scoped object key and returns no internal path", async () => {
    const response = await uploadClientFile(
      multipartRequest(
        new File(["png"], "../../Мария\\паспорт.png", {
          type: "image/png",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.getProject).toHaveBeenCalledWith("valid-intake-token");
    expect(mocks.storageUpload).toHaveBeenCalledOnce();

    const [path, uploadedFile, options] = mocks.storageUpload.mock.calls[0]!;
    expect(path).toMatch(
      /^00000000-0000-4000-8000-000000000111\/[0-9a-f-]{36}\.png$/,
    );
    expect(path).not.toContain("Мария");
    expect(path).not.toContain("..");
    expect(uploadedFile).toBeInstanceOf(File);
    expect(options).toEqual({ contentType: "image/png", upsert: false });

    expect(mocks.answerQuery.eq).toHaveBeenNthCalledWith(
      1,
      "project_id",
      project.id,
    );
    expect(mocks.answerUpsert).toHaveBeenCalledWith(
      {
        project_id: project.id,
        question_id: "attachments",
        value: [
          {
            path,
            name: "паспорт.png",
            size: 3,
            type: "image/png",
          },
        ],
      },
      { onConflict: "project_id,question_id" },
    );
  });

  it("does not expose storage internals when upload fails", async () => {
    mocks.storageUpload.mockResolvedValueOnce({
      error: {
        message: `permission denied at ${project.id}/private-client-name.pdf`,
      },
    });
    const response = await uploadClientFile(
      multipartRequest(
        new File(["pdf"], "private-client-name.pdf", {
          type: "application/pdf",
        }),
      ),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upload_failed" });
  });

  it("allows signing only a flat object key belonging to the authorized project", () => {
    expect(
      isProjectClientUploadPath(
        `${project.id}/1720000000000-plan.pdf`,
        project.id,
      ),
    ).toBe(true);
    expect(
      isProjectClientUploadPath(
        `${project.id}/00000000-0000-4000-8000-000000000333.png`,
        project.id,
      ),
    ).toBe(true);
    expect(
      isProjectClientUploadPath(
        "00000000-0000-4000-8000-000000000999/private.pdf",
        project.id,
      ),
    ).toBe(false);
    expect(
      isProjectClientUploadPath(
        `${project.id}/../00000000-0000-4000-8000-000000000999/private.pdf`,
        project.id,
      ),
    ).toBe(false);
    expect(
      isProjectClientUploadPath(
        `${project.id}/%2e%2e%2fprivate.pdf`,
        project.id,
      ),
    ).toBe(false);
  });

  it("checks the project prefix before service-role URL signing", () => {
    const dashboardSource = readFileSync(
      resolve(process.cwd(), "app/dashboard/projects/[id]/page.tsx"),
      "utf8",
    );
    const scopeCheck = dashboardSource.indexOf(
      "isProjectClientUploadPath(path, project.id)",
    );
    const signCall = dashboardSource.indexOf(
      '.from("client-uploads").createSignedUrl(path, 3600)',
    );

    expect(scopeCheck).toBeGreaterThanOrEqual(0);
    expect(signCall).toBeGreaterThan(scopeCheck);
  });
});
