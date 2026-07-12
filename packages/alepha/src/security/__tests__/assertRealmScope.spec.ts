import { Alepha } from "alepha";
import { ForbiddenError } from "alepha/server";
import { describe, expect, it } from "vitest";
import { SecurityProvider } from "../providers/SecurityProvider.ts";

describe("SecurityProvider.assertRealmScope", () => {
  const security = () => Alepha.create().inject(SecurityProvider);

  it("returns the caller's realm when no target realm is requested", () => {
    expect(security().assertRealmScope({ realm: "acme" }, undefined)).toBe(
      "acme",
    );
  });

  it("allows a target realm that matches the caller's realm", () => {
    expect(security().assertRealmScope({ realm: "acme" }, "acme")).toBe("acme");
  });

  it("rejects a target realm different from the caller's realm (P0-7)", () => {
    // A realm-A admin must not be able to act on realm B via ?userRealmName=B.
    expect(() =>
      security().assertRealmScope({ realm: "acme" }, "victim-tenant"),
    ).toThrow(ForbiddenError);
  });

  it("is a no-op for single-realm apps (no caller realm claim)", () => {
    expect(security().assertRealmScope(undefined, undefined)).toBeUndefined();
  });
});
