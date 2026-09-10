import { describe, it } from "vitest";

import { isOAuthReturnTarget } from "../src/web/app/components/auth/oauthReturnTarget.ts";

/**
 * Where the sign-in bridge may send somebody back to, #Q2217.
 *
 * The bridge used to accept `/oauth/authorize` alone, so a signed-out human
 * opening the device approval link signed in and was dropped on the home
 * page, with the code they came to approve gone from the URL.
 */
describe("isOAuthReturnTarget", () => {
  it("accepts the two server-rendered OAuth pages, with or without a query", ({
    expect,
  }) => {
    expect(isOAuthReturnTarget("/oauth/authorize?client_id=x")).toBe(true);
    expect(isOAuthReturnTarget("/oauth/device")).toBe(true);
    expect(isOAuthReturnTarget("/oauth/device?user_code=CDFG-HJKM")).toBe(true);
  });

  it("refuses anything that would leave the origin", ({ expect }) => {
    expect(isOAuthReturnTarget("https://evil.example/oauth/device")).toBe(
      false,
    );
    expect(isOAuthReturnTarget("//evil.example/oauth/device")).toBe(false);
  });

  it("refuses a path that only starts like one of them", ({ expect }) => {
    expect(isOAuthReturnTarget("/oauth/devices")).toBe(false);
    expect(isOAuthReturnTarget("/oauth/token")).toBe(false);
    expect(isOAuthReturnTarget("/")).toBe(false);
  });

  it("refuses nothing at all", ({ expect }) => {
    expect(isOAuthReturnTarget(undefined)).toBe(false);
    expect(isOAuthReturnTarget(null)).toBe(false);
    expect(isOAuthReturnTarget("")).toBe(false);
  });
});
