import { describe, it } from "vitest";
import { collectSubset } from "./QuestGraph.tsx";

describe("collectSubset", () => {
  it("keeps an out-of-subset predecessor as a stub so its dependent is not shown as ready", ({
    expect,
  }) => {
    const all = [
      { id: 1, shortId: 1, title: "outside", status: "new" as const },
      {
        id: 2,
        shortId: 2,
        title: "inside",
        status: "new" as const,
        dependsOn: 1,
      },
    ];
    const { chain } = collectSubset(all, new Set([2]));
    expect(chain.map((q) => q.id).sort()).toEqual([1, 2]);
    expect(chain.find((q) => q.id === 2)?.step).toBe(2);
  });

  it("includes every member quest even when it has no dependency edges at all", ({
    expect,
  }) => {
    const all = [
      { id: 1, shortId: 1, title: "lone quest", status: "new" as const },
      { id: 2, shortId: 2, title: "unrelated", status: "new" as const },
    ];
    const { chain } = collectSubset(all, new Set([1]));
    expect(chain.map((q) => q.id)).toEqual([1]);
    expect(chain[0]?.step).toBe(1);
  });

  it("does not pull in a member's dependent that lives outside the subset", ({
    expect,
  }) => {
    const all = [
      { id: 1, shortId: 1, title: "inside", status: "new" as const },
      {
        id: 2,
        shortId: 2,
        title: "outside dependent",
        status: "new" as const,
        dependsOn: 1,
      },
    ];
    const { chain } = collectSubset(all, new Set([1]));
    expect(chain.map((q) => q.id)).toEqual([1]);
  });

  it("does not add a stub for a predecessor that is already a member", ({
    expect,
  }) => {
    const all = [
      { id: 1, shortId: 1, title: "root", status: "new" as const },
      {
        id: 2,
        shortId: 2,
        title: "child",
        status: "new" as const,
        dependsOn: 1,
      },
    ];
    const { chain } = collectSubset(all, new Set([1, 2]));
    expect(chain.map((q) => q.id).sort()).toEqual([1, 2]);
    expect(chain.find((q) => q.id === 1)?.step).toBe(1);
    expect(chain.find((q) => q.id === 2)?.step).toBe(2);
  });
});
