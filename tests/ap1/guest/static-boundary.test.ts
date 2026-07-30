import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const helper = readFileSync(
  new URL(
    "../../../lib/project-intelligence/delivery/projectceo/guest-link.ts",
    import.meta.url,
  ),
  "utf8",
);
const route = readFileSync(
  new URL(
    "../../../app/projectceo/guest/[token]/route.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("AP1 guest-link static boundary", () => {
  it("keeps token hashing server-only and the runtime on the anonymous exact-release RPC", () => {
    expect(helper).toContain('import "server-only"');
    expect(helper).toContain('from "@supabase/supabase-js"');
    expect(helper).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(helper).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(helper).toContain('.schema("projectceo_api")');
    expect(helper).toContain('.rpc("read_guest_release"');
    expect(helper).not.toMatch(/service[_-]?role|admin|cookies?\s*\(/i);
    expect(helper).not.toMatch(/projectceo_foundation\.|project_intelligence\./);
    expect(route).not.toMatch(/console\.|logger\.|service[_-]?role/i);
    expect(route).toContain('"Cache-Control": "private, no-store"');
    expect(route).toContain('"Referrer-Policy": "no-referrer"');
  });
});
