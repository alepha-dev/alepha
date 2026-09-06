import { renderHook } from "@testing-library/react";
import { $inject, Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { LinkProvider } from "alepha/server/links";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import {
  type QuestResource,
  questResourceSchema,
} from "@/api/schemas/questResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";
import { currentAssignedQuestsAtom } from "@/web/app/atoms/currentAssignedQuestsAtom.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { currentQuestCountAtom } from "@/web/app/atoms/currentQuestCountAtom.ts";

import { useQuestMutations } from "./useQuestMutations.ts";

/**
 * Stands in for the HTTP-backed `useClient<QuestController>()`. Same
 * substitution seam as `QuestDependencyPicker.browser.spec.tsx`
 * (`CLAUDE.md`: never `vi.mock` / `vi.spyOn`).
 *
 * Quests are generated from the resource schema rather than hand-listed:
 * `currentAssignedQuestsAtom` validates on every `set`, and a fixture
 * written field-by-field turns each new required column into an unrelated
 * red test.
 *
 * `openCount` is what the server would answer next. These cases turn on the
 * badge being re-derived rather than decremented locally, so the fake has to
 * be able to disagree with any local arithmetic.
 */
class FakeLinkProvider extends LinkProvider {
  protected readonly faker = $inject(FakeProvider);

  openCount = 7;
  counted = 0;
  calls: string[] = [];

  public quest(id: number): QuestResource {
    return {
      ...this.faker.generate(questResourceSchema),
      id,
      shortId: id,
      projectId: 1,
      title: `Quest ${id}`,
    };
  }

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const record =
      (name: string) =>
      async (config: { params: { id: number } }): Promise<QuestResource> => {
        this.calls.push(`${name}:${config.params.id}`);
        return this.quest(config.params.id);
      };
    return {
      acceptQuest: record("accept"),
      abandonQuest: record("abandon"),
      completeQuest: record("complete"),
      shelveQuest: record("shelve"),
      unshelveQuest: record("unshelve"),
      deleteQuest: record("delete"),
      countOpenQuests: async () => {
        this.counted++;
        return { count: this.openCount };
      },
    };
  }
}

/**
 * The table refreshed the open count and forgot the assigned list, the
 * detail view did the opposite, and the board did half of one and none of
 * the other - so the sidebar badge and the Quest Log lagged behind whichever
 * surface the reader happened to act from.
 *
 * These cases pin which atom each transition moves, which is the part that
 * is easy to get subtly wrong: shelve deliberately leaves the assigned list
 * alone, and accept deliberately leaves the count alone.
 */
describe("useQuestMutations", () => {
  const mount = async (assignedIds: number[] = []) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaFake)
      // Before the modules that reach for it - a substitution after
      // `LinkProvider` has been instantiated is a `TooLateSubstitutionError`.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact);
    await alepha.start();

    const fake = alepha.inject(FakeLinkProvider);
    alepha.store.set(currentProjectAtom, projectFixture() as never);
    alepha.store.set(
      currentAssignedQuestsAtom,
      assignedIds.map((id) => fake.quest(id)),
    );
    alepha.store.set(currentQuestCountAtom, { count: 99 });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
    );
    return {
      alepha,
      fake,
      assigned: () =>
        (alepha.store.get(currentAssignedQuestsAtom) ?? []).map((q) => q.id),
      count: () => alepha.store.get(currentQuestCountAtom)?.count,
      ...renderHook(() => useQuestMutations(), { wrapper }),
    };
  };

  it("adds to the Quest Log on accept, and leaves the badge alone", async ({
    expect,
  }) => {
    const ctx = await mount();

    await ctx.result.current.accept(5);

    expect(ctx.assigned()).toEqual([5]);
    // An accepted quest is still open, so the number did not move - and a
    // request that cannot change anything is not worth making.
    expect(ctx.count()).toBe(99);
    expect(ctx.fake.counted).toBe(0);
  });

  it("does not add the same quest twice", async ({ expect }) => {
    const ctx = await mount([5]);

    await ctx.result.current.accept(5);

    expect(ctx.assigned()).toEqual([5]);
  });

  it("drops from the Quest Log and re-derives the badge on complete", async ({
    expect,
  }) => {
    const ctx = await mount([5, 6]);
    ctx.fake.openCount = 4;

    await ctx.result.current.complete(5, {});

    expect(ctx.assigned()).toEqual([6]);
    // Re-derived, not decremented: 4 is what the server says, and a local
    // `99 - 1` would be wrong for any quest behind the planned-epic gate,
    // which was never in the number to begin with.
    expect(ctx.count()).toBe(4);
    expect(ctx.fake.counted).toBe(1);
  });

  it("drops from the Quest Log on unassign, and leaves the badge alone", async ({
    expect,
  }) => {
    const ctx = await mount([5]);

    await ctx.result.current.unassign(5);

    expect(ctx.assigned()).toEqual([]);
    expect(ctx.count()).toBe(99);
    expect(ctx.fake.counted).toBe(0);
  });

  it("leaves the Quest Log alone on shelve, and re-derives the badge", async ({
    expect,
  }) => {
    const ctx = await mount([5]);
    ctx.fake.openCount = 3;

    await ctx.result.current.shelve(5);

    // Deliberate: the server's own assigned-quests query filters on
    // `completedAt` and `acceptedBy`, never on `shelvedAt`. A shelved quest
    // you hold is still yours, and dropping it here would make the atom
    // disagree with the list the next navigation fetches.
    expect(ctx.assigned()).toEqual([5]);
    expect(ctx.count()).toBe(3);
  });

  it("re-derives the badge on unshelve", async ({ expect }) => {
    const ctx = await mount();
    ctx.fake.openCount = 8;

    await ctx.result.current.unshelve(5);

    expect(ctx.count()).toBe(8);
  });

  it("leaves both on delete", async ({ expect }) => {
    const ctx = await mount([5]);
    ctx.fake.openCount = 2;

    await ctx.result.current.remove(5);

    expect(ctx.assigned()).toEqual([]);
    expect(ctx.count()).toBe(2);
    expect(ctx.fake.calls).toEqual(["delete:5"]);
  });
});
