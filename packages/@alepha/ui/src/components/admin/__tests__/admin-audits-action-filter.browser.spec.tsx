import { describe, expect, it } from "vitest";

import { auditActionFromKey, auditActionKey } from "../admin-audits.tsx";

/**
 * The Action filter's value is the `type:action` key the Action column
 * prints, and the query takes it apart into both halves (feedback #2049: a
 * bare `create` selected every type's create at once). The key is looked up
 * in the fetched pairs rather than split, so a type carrying a colon is never
 * cut in the wrong place; the split is only the fallback for a key the list
 * no longer holds.
 */
describe("the audit action filter's key", () => {
  const pairs = [
    { type: "parameter", action: "create" },
    { type: "user", action: "create" },
    { type: "api:notifications", action: "send" },
  ];

  it("round-trips a pair through the key the column prints", () => {
    expect(auditActionKey({ type: "user", action: "create" })).toBe(
      "user:create",
    );
    expect(auditActionFromKey("user:create", pairs)).toEqual({
      type: "user",
      action: "create",
    });
    // Same action name, other type: the whole point of carrying the type.
    expect(auditActionFromKey("parameter:create", pairs)).toEqual({
      type: "parameter",
      action: "create",
    });
  });

  it("resolves a type that carries a colon through the list, not a split", () => {
    expect(auditActionFromKey("api:notifications:send", pairs)).toEqual({
      type: "api:notifications",
      action: "send",
    });
  });

  it("falls back to the first colon for a key the list no longer holds", () => {
    // A persisted filter from before its audit type was renamed away.
    expect(auditActionFromKey("session:login", pairs)).toEqual({
      type: "session",
      action: "login",
    });
    expect(auditActionFromKey("orphan", pairs)).toEqual({
      type: "orphan",
      action: "",
    });
  });
});
