import type { ProjectEvent } from "@lore/core/api";
import { LoreMcpIdentity } from "@lore/core/mcp";
import { createTestProject } from "@lore/core/testing";
import { PlanPrompts } from "@lore/plan/api";
import { QuestTools } from "@lore/plan/mcp";
import { createTestEpic, createTestQuest } from "@lore/plan/testing";
import { PromptController } from "@lore/prompts/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

/**
 * The prompts and the draft (#Q4381, epic #E178): a work prompt files what
 * it finds in passing as a draft, the epic review says an epic's quests are
 * drafts until it is ready, a run of loose quests never takes a draft, and
 * no prompt nor the MCP server instructions describe hidden quests.
 */
describe("prompts and drafts", () => {
  let alepha: Alepha;
  let prompts: PromptController;
  let plan: PlanPrompts;
  let questTools: QuestTools;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let owner: UserAccountToken;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaMcp);
    bootLore(alepha, ["api", "mcp"]);
    alepha.inject(TestEntityRepositories);
    prompts = alepha.inject(PromptController);
    plan = alepha.inject(PlanPrompts);
    questTools = alepha.inject(QuestTools);
    await alepha.start();
    project = await createTestProject(alepha, { title: "Acme" });
    owner = { id: project.createdBy!, roles: ["user"] };
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const render = async (name: string, args: Record<string, string> = {}) =>
    (
      await prompts.renderPrompt.run(
        { params: { projectId: project.id, name }, body: { args } },
        { user: owner },
      )
    ).text;

  const OLD_MODEL = [
    "hidden",
    "includeDrafts",
    "out of the backlog",
    "backlog gate",
  ];

  describe("a run of loose quests", () => {
    it("takes the to-do quest and never the draft, with one of each", async ({
      expect,
    }) => {
      const draft = await createTestQuest(alepha, project, {
        title: "A draft",
        draftAt: new Date().toISOString(),
      });
      const event = (shortId: number) =>
        ({
          projectId: project.id,
          subjectKind: "quest",
          subjectId: String(shortId),
        }) as ProjectEvent;

      // A draft alone plans no run, and its own event is not heard.
      expect(await plan.looseQuests(project.id)).toBe(false);
      expect(await plan.looseQuestEvent(event(draft.shortId))).toBe(false);

      const todo = await createTestQuest(alepha, project, { title: "To do" });
      expect(await plan.looseQuests(project.id)).toBe(true);
      expect(await plan.looseQuestEvent(event(todo.shortId))).toBe(true);

      // The list the prompt has the run take: `quest_list` with status
      // "todo". The draft is not on it.
      const listed = (await alepha.context.run(() => {
        alepha.store.set(currentUserAtom, owner);
        return questTools.quest_list.execute({
          project: project.id,
          status: "todo",
        });
      })) as { quests: Array<{ shortId: number; status: string }> };
      expect(listed.quests.map((it) => it.shortId)).toEqual([todo.shortId]);

      const text = await render("work-loose-quests");
      expect(text).toContain('Call `quest_list` with status "todo"');
      expect(text).toContain(
        "Only `todo` quests are taken: a `draft` is never on the list, nor accepted, until its owner marks it ready.",
      );
    });
  });

  describe("the work prompts", () => {
    it("file a follow-up found in passing as a draft the owner marks ready", async ({
      expect,
    }) => {
      const quest = await createTestQuest(alepha, project, { title: "Work" });
      const epic = await createTestEpic(alepha, project, { status: "ready" });

      const workQuest = await render("work-quest", {
        quest: `#Q${quest.shortId}`,
      });
      const workEpic = await render("work-epic", { epic: `#E${epic.number}` });
      const loose = await render("work-loose-quests");

      expect(workQuest).toContain(
        "a problem or a follow-up found in passing, which this run will not take, is filed as a draft (`quest_create` with `draft: true`): the owner reads it and marks it ready.",
      );
      expect(workEpic).toContain(
        "is filed as a loose draft (`quest_create` with `draft: true` and no `epic_number`): the owner reads it and marks it ready.",
      );
      // The frozen quest set still holds: nothing new goes into the epic.
      expect(workEpic).toContain("never a new quest in it");
      expect(loose).toContain(
        "A problem or a follow-up you find in passing is not part of it either: file it as a draft (`quest_create` with `draft: true`), and the owner marks it ready.",
      );
    });

    it("keep feedback and triage filing to-do quests", async ({ expect }) => {
      const list = await prompts.listPrompts.run(
        { params: { projectId: project.id } },
        { user: owner },
      );
      const byName = Object.fromEntries(list.items.map((it) => [it.name, it]));
      for (const name of ["work-feedback", "triage"]) {
        expect(byName[name]!.text).not.toContain("draft: true");
      }
    });
  });

  describe("the epic review", () => {
    it("says an epic's quests are drafts until it is ready, with nothing to do one by one", async ({
      expect,
    }) => {
      const epic = await createTestEpic(alepha, project, { status: "draft" });

      const text = await render("review-epic", { epic: `#E${epic.number}` });

      expect(text).toContain(
        "The epic's quests are drafts while it is a `draft`, and become to do together when the owner marks it ready: nothing is to be done to them one by one, and a quest filed into it while it is a draft is a draft too.",
      );
    });
  });

  describe("the old model", () => {
    it("is in no built-in prompt and not in the MCP server instructions", async ({
      expect,
    }) => {
      const list = await prompts.listPrompts.run(
        { params: { projectId: project.id } },
        { user: owner },
      );
      for (const prompt of list.items) {
        for (const words of OLD_MODEL) {
          expect(
            prompt.text.includes(words),
            `${prompt.name} says "${words}"`,
          ).toBe(false);
        }
      }

      const instructions = alepha.inject(LoreMcpIdentity).instructions;
      for (const words of OLD_MODEL) {
        expect(instructions).not.toContain(words);
      }
      expect(instructions).toContain(
        "Work you find in passing and do not take now is filed as a draft (quest_create with draft: true): its owner marks it ready.",
      );
    });
  });
});
