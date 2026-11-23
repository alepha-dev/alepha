import { describe, it } from "vitest";

import { offeredAgents } from "./offeredAgents.ts";

const items = [
  { id: "lore", handle: "lore", name: "Lore", builtin: true },
  {
    id: crypto.randomUUID(),
    handle: "jarvis",
    name: "Jarvis",
    builtin: false,
    avatarId: crypto.randomUUID(),
  },
];

describe("offeredAgents", () => {
  it("offers lore then the project's agents, with their pictures", ({
    expect,
  }) => {
    const offered = offeredAgents({ items, enabled: true });

    expect(offered.map((it) => it.handle)).toEqual(["lore", "jarvis"]);
    expect(offered[0]).toMatchObject({ builtin: true, label: "Lore" });
    expect(offered[1]).toMatchObject({
      builtin: false,
      label: "Jarvis",
      avatarId: items[1]!.avatarId,
    });
  });

  it("offers no agent with AI off, the project's own included", ({
    expect,
  }) => {
    expect(offeredAgents({ items, enabled: false })).toEqual([]);
    expect(offeredAgents(undefined)).toEqual([]);
  });
});
