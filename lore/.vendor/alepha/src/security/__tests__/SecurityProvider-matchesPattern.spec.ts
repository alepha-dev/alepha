import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { SecurityProvider } from "../providers/SecurityProvider.ts";

/**
 * Exposes the protected matcher shared by role grants, their excludes and
 * permission scopes.
 */
class TestSecurityProvider extends SecurityProvider {
  public testMatchesPattern = this.matchesPattern.bind(this);
}

describe("SecurityProvider.matchesPattern", () => {
  const matcher = () =>
    Alepha.create()
      .with({ provide: SecurityProvider, use: TestSecurityProvider })
      .inject(TestSecurityProvider).testMatchesPattern;

  it("matches everything with '*'", () => {
    const matches = matcher();

    expect(matches("docs:read", "*")).toBe(true);
    expect(matches("standalone", "*")).toBe(true);
  });

  it("matches an exact string and nothing else", () => {
    const matches = matcher();

    expect(matches("docs:read", "docs:read")).toBe(true);
    expect(matches("docs:read", "docs:write")).toBe(false);
    expect(matches("docs:reader", "docs:read")).toBe(false);
  });

  it("matches 'prefix:*' at any depth", () => {
    const matches = matcher();

    expect(matches("admin:read", "admin:*")).toBe(true);
    expect(matches("admin:api:users:read", "admin:*")).toBe(true);
    expect(matches("admin:api:users:read", "admin:api:*")).toBe(true);
  });

  it("does not match the bare prefix with 'prefix:*'", () => {
    const matches = matcher();

    expect(matches("admin", "admin:*")).toBe(false);
    expect(matches("admin:api", "admin:api:*")).toBe(false);
  });

  it("does not match a sibling that only shares leading characters", () => {
    const matches = matcher();

    expect(matches("administrator:read", "admin:*")).toBe(false);
  });

  it("treats a wildcard on the permission as a literal, never as a pattern", () => {
    // The scope direction: the wildcard belongs to the grant. A concrete
    // grant of `docs:read` must not satisfy a requirement spelled `docs:*`.
    const matches = matcher();

    expect(matches("docs:*", "docs:read")).toBe(false);
  });
});
