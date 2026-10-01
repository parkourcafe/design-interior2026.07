import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { regionalSupabaseConfig } from "./cells";
import {
  DASHBOARD_REGIONAL_SESSION_COOKIE,
  dashboardSessionCookieName,
  documentCookieNames,
} from "./session-cookie";

describe("dashboardSessionCookieName", () => {
  it("совпадает с именем, под которым вход пишет RU-сессию", () => {
    const config = regionalSupabaseConfig("ru", {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.cookieName).toBe(DASHBOARD_REGIONAL_SESSION_COOKIE);
  });

  it("находит региональную сессию, в том числе разбитую на части", () => {
    expect(dashboardSessionCookieName(["sb-remhaos-ru-auth-token"])).toBe(DASHBOARD_REGIONAL_SESSION_COOKIE);
    expect(dashboardSessionCookieName(["x", "sb-remhaos-ru-auth-token.0", "sb-remhaos-ru-auth-token.1"]))
      .toBe(DASHBOARD_REGIONAL_SESSION_COOKIE);
  });

  it("без региональной куки — стандартное имя Supabase (старые аккаунты)", () => {
    expect(dashboardSessionCookieName(["sb-abc-auth-token"])).toBeUndefined();
    expect(dashboardSessionCookieName([])).toBeUndefined();
  });

  it("не принимает похожие имена и сессию другого контура", () => {
    expect(dashboardSessionCookieName(["sb-remhaos-ru-auth-token-code-verifier"])).toBeUndefined();
    expect(dashboardSessionCookieName(["sb-remhaos-us-auth-token"])).toBeUndefined();
  });

  it("разбирает document.cookie", () => {
    expect(documentCookieNames("a=1; sb-remhaos-ru-auth-token.0=base64-x; b=")).toEqual([
      "a", "sb-remhaos-ru-auth-token.0", "b",
    ]);
    expect(documentCookieNames("")).toEqual([]);
  });
});

describe("cells: публичные значения доступны браузерной сборке", () => {
  // Next.js встраивает в браузер только статические `process.env.NEXT_PUBLIC_…`.
  it("каждый NEXT_PUBLIC_SUPABASE_* указан статически", () => {
    const source = readFileSync(join(__dirname, "cells.ts"), "utf8");
    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL_US",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_US",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY_US",
    ]) {
      expect(source).toContain(`${name}: process.env.${name},`);
    }
  });
});
