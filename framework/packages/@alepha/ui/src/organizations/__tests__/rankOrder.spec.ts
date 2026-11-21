import { describe, expect, it } from "vitest";

import { rankOrder } from "../rankOrder.ts";

describe("rankOrder", () => {
  it("puts the owner rank first when Admin ties with it on count", () => {
    const ranks = [
      { key: "member", name: "Member", permissions: ["a"] },
      { key: "admin", name: "Admin", permissions: ["a", "b"] },
      { key: "owner", name: "Owner", permissions: ["*"] },
    ];

    const ordered = rankOrder(ranks, (rank) => (rank.key === "member" ? 1 : 2));

    expect(ordered.map((rank) => rank.name)).toEqual([
      "Owner",
      "Admin",
      "Member",
    ]);
  });

  it("puts the owner rank first even when it counts less", () => {
    const ranks = [
      { key: "admin", name: "Admin", permissions: ["a", "b"] },
      { key: "owner", name: "Captain", permissions: ["a"] },
    ];

    expect(rankOrder(ranks).map((rank) => rank.key)).toEqual([
      "owner",
      "admin",
    ]);
  });

  it("sorts the other ranks by power, then by name", () => {
    const ranks = [
      { key: "b", name: "Beta", permissions: ["a"] },
      { key: "a", name: "Alpha", permissions: ["a"] },
      { key: "c", name: "Gamma", permissions: ["a", "b"] },
    ];

    expect(rankOrder(ranks).map((rank) => rank.name)).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
    ]);
  });
});
