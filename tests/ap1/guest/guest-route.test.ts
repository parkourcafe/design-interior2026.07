import { expect, it, vi } from "vitest";

const guestLinkMock = vi.hoisted(() => {
  type ErrorCode =
    | "invalid_token"
    | "not_found"
    | "revoked"
    | "expired"
    | "forbidden"
    | "internal_error";

  class ProjectCeoGuestLinkError extends Error {
    readonly code: ErrorCode;

    constructor(code: ErrorCode) {
      super(code);
      this.name = "ProjectCeoGuestLinkError";
      this.code = code;
    }
  }

  return {
    ProjectCeoGuestLinkError,
    readProjectCeoGuestRelease: vi.fn(),
  };
});

vi.mock("@/lib/project-intelligence/delivery/projectceo/guest-link", () => ({
  ProjectCeoGuestLinkError: guestLinkMock.ProjectCeoGuestLinkError,
  readProjectCeoGuestRelease: guestLinkMock.readProjectCeoGuestRelease,
}));

import { GET } from "../../../app/projectceo/guest/[token]/route";

function expectPrivateGuestHeaders(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");

  const robots = response.headers.get("X-Robots-Tag")?.toLowerCase() ?? "";
  expect(robots).toContain("noindex");
  expect(robots).toContain("nofollow");
}

function visibleHtmlText(html: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };

  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, entity: string) =>
      String.fromCodePoint(
        entity.toLowerCase().startsWith("x")
          ? Number.parseInt(entity.slice(1), 16)
          : Number.parseInt(entity, 10),
      ),
    )
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (match, entity: string) =>
      namedEntities[entity.toLowerCase()] ?? match,
    )
    .replace(/\s+/g, " ")
    .trim();
}

it("renders an escaped non-cacheable guest release and maps guest-link failures without leaking secrets", async () => {
  const rawToken = "guest-token-super-secret-<raw>";
  const projection = {
    allowAcknowledgement: true,
    expiresAt: "2026-08-18T12:34:56.000Z",
    package: {
      id: "0f97565d-7a63-4db0-9f61-d3be78e77207",
      kind: "work_package",
      name: "Пакет <script>alert(\"package-name\")</script> & 'Премиум'",
      stableKey: "wp\"><img src=x onerror=\"stable-key-leak\">",
    },
    projectId: "2ddf531b-6bc8-457d-bcc6-36f4651259ea",
    release: {
      graphDigest: "a3b91d763e80aeaa0c6cd8ff2e6b9f0365b58b7f7a50a77ae179e53ab8f108c4",
      publishedAt: "2026-07-18T08:15:30.000Z",
      versionId: "909fe699-aef9-4ec7-9774-63c4d23bf782",
      versionNo: 37,
    },
  };

  guestLinkMock.readProjectCeoGuestRelease.mockReset();
  guestLinkMock.readProjectCeoGuestRelease.mockResolvedValueOnce(projection);

  const success = await GET(
    new Request(
      `https://archidom.example/projectceo/guest/${encodeURIComponent(rawToken)}`,
    ),
    { params: Promise.resolve({ token: rawToken }) },
  );

  expect(success.status).toBe(200);
  expect(success.headers.get("Content-Type")).toMatch(/^text\/html\b/i);
  expectPrivateGuestHeaders(success);
  expect(guestLinkMock.readProjectCeoGuestRelease).toHaveBeenCalledTimes(1);
  expect(guestLinkMock.readProjectCeoGuestRelease).toHaveBeenCalledWith(rawToken);

  const successBody = await success.text();
  const visibleText = visibleHtmlText(successBody);
  for (const exactValue of [
    projection.projectId,
    projection.package.id,
    projection.package.name,
    projection.package.stableKey,
    projection.package.kind,
    projection.release.versionId,
    String(projection.release.versionNo),
    projection.release.graphDigest,
    projection.release.publishedAt,
    projection.expiresAt,
  ]) {
    expect(visibleText).toContain(exactValue);
  }
  expect(successBody).not.toContain(projection.package.name);
  expect(successBody).not.toContain(projection.package.stableKey);
  expect(successBody).not.toContain(rawToken);
  expect(successBody).not.toContain(encodeURIComponent(rawToken));

  const errorCases = [
    ["invalid_token", 404],
    ["not_found", 404],
    ["revoked", 403],
    ["expired", 403],
    ["forbidden", 403],
    ["internal_error", 500],
    ["unexpected_error", 500],
  ] as const;

  for (const [caseName, expectedStatus] of errorCases) {
    const backendMessage = `backend-message-${caseName}-must-not-leak`;
    const backendDetails = `backend-details-${caseName}-must-not-leak`;
    const error =
      caseName === "unexpected_error"
        ? new Error(backendMessage)
        : new guestLinkMock.ProjectCeoGuestLinkError(caseName);
    error.message = backendMessage;
    Object.assign(error, { details: backendDetails });

    const errorToken = `${rawToken}-${caseName}`;
    guestLinkMock.readProjectCeoGuestRelease.mockReset();
    guestLinkMock.readProjectCeoGuestRelease.mockRejectedValueOnce(error);

    const response = await GET(
      new Request(
        `https://archidom.example/projectceo/guest/${encodeURIComponent(errorToken)}`,
      ),
      { params: Promise.resolve({ token: errorToken }) },
    );

    expect(response.status).toBe(expectedStatus);
    expectPrivateGuestHeaders(response);
    expect(guestLinkMock.readProjectCeoGuestRelease).toHaveBeenCalledTimes(1);
    expect(guestLinkMock.readProjectCeoGuestRelease).toHaveBeenCalledWith(errorToken);

    const errorBody = await response.text();
    expect(errorBody.trim()).not.toBe("");
    expect(errorBody).not.toContain(errorToken);
    expect(errorBody).not.toContain(encodeURIComponent(errorToken));
    expect(errorBody).not.toContain(backendMessage);
    expect(errorBody).not.toContain(backendDetails);
  }
});
