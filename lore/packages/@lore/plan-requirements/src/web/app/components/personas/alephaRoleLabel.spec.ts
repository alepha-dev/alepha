import { describe, it } from "vitest";

import { alephaRoleLabel } from "./alephaRoleLabel.ts";

describe("alephaRoleLabel", () => {
  it("humanizes an identifier into a badge", ({ expect }) => {
    expect(alephaRoleLabel("control_room")).toEqual({
      kind: "badge",
      label: "Control room",
    });
    expect(alephaRoleLabel("shop-manager")).toEqual({
      kind: "badge",
      label: "Shop manager",
    });
    expect(alephaRoleLabel("fieldOperator")).toEqual({
      kind: "badge",
      label: "Field operator",
    });
    expect(alephaRoleLabel("admin")).toEqual({ kind: "badge", label: "Admin" });
  });

  it("keeps a sentence as plain text, as written", ({ expect }) => {
    const sentence =
      "field operator on the station edge; viewer on the hub for a round";
    expect(alephaRoleLabel(sentence)).toEqual({
      kind: "text",
      text: sentence,
    });
    expect(alephaRoleLabel("viewer")).toEqual({
      kind: "badge",
      label: "Viewer",
    });
  });

  it("keeps an identifier too long for a badge as text", ({ expect }) => {
    const long = "a_very_long_service_account_identifier_name";
    expect(alephaRoleLabel(long)).toEqual({ kind: "text", text: long });
  });
});
