import {
  LorePermissions,
  ProjectMergeService,
  PromptRegistry,
} from "@lore/core/api";
import { createTestMember, createTestProject } from "@lore/core/testing";
import { createTestEpic, createTestQuest } from "@lore/plan/testing";
import { PromptController } from "@lore/prompts/api";
import { prompts } from "@lore/prompts/schemas";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

class PromptRows {
  rows = $repository(prompts);
}

/**
 * Prompts (#E174, #Q4274): the built-ins of the server's registry merged
 * with a project's rows, custom prompts, duplicate, render with typed args
 * and the statuses each arg accepts, the merge, and `prompt:manage`.
 */
describe("prompts", () => {
  let alepha: Alepha;
  let controller: PromptController;
  let rows: PromptRows["rows"];
  let registry: PromptRegistry;
  let merge: ProjectMergeService;
  let entities: TestEntityRepositories;
  let owner: UserAccountToken;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    bootLore(alepha);
    controller = alepha.inject(PromptController);
    rows = alepha.inject(PromptRows).rows;
    registry = alepha.inject(PromptRegistry);
    merge = alepha.inject(ProjectMergeService);
    entities = alepha.inject(TestEntityRepositories);
    await alepha.start();
    project = await createTestProject(alepha, { title: "Acme" });
    owner = { id: project.createdBy!, roles: ["user"] };
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const list = async (projectId = project.id) =>
    (
      await controller.listPrompts.run(
        { params: { projectId } },
        { user: owner },
      )
    ).items;
  const render = (name: string, args: Record<string, string>, user = owner) =>
    controller.renderPrompt.run(
      { params: { projectId: project.id, name }, body: { args } },
      { user },
    );

  it("pins a prompt to the registered pages only: a built-in's row created, an unknown page refused (#Q4284)", async ({
    expect,
  }) => {
    const answer = await controller.listPrompts.run(
      { params: { projectId: project.id } },
      { user: owner },
    );
    expect(answer.pages.map((it) => it.key)).toEqual([
      "quests",
      "quest",
      "epics",
      "epic",
      "feedback",
      "feedback-item",
      "errors",
    ]);
    expect(answer.pages.find((it) => it.key === "quest")?.gives).toBe("quest");
    const pinned = await controller.updatePrompt.run(
      {
        params: { projectId: project.id, name: "work-quest" },
        body: { pins: ["quest", "quests", "quest"] },
      },
      { user: owner },
    );
    expect(pinned.pins).toEqual(["quest", "quests"]);
    const row = await rows.getOne({
      where: { projectId: { eq: project.id }, name: { eq: "work-quest" } },
    });
    expect(row).toMatchObject({ builtin: true, pins: ["quest", "quests"] });
    expect((await list()).find((it) => it.name === "work-quest")?.pins).toEqual(
      ["quest", "quests"],
    );

    await expect(
      controller.updatePrompt.run(
        {
          params: { projectId: project.id, name: "work-quest" },
          body: { pins: ["dashboard"] },
        },
        { user: owner },
      ),
    ).rejects.toThrow("No page 'dashboard' to pin a prompt to");
  });

  it("pins each built-in to its pages until the project sets its own, and keeps an unpin from every page (#Q4339)", async ({
    expect,
  }) => {
    const answer = await controller.listPrompts.run(
      { params: { projectId: project.id } },
      { user: owner },
    );
    const pinsOf = (items: typeof answer.items) =>
      Object.fromEntries(items.map((it) => [it.name, it.pins]));
    expect(pinsOf(answer.items)).toMatchObject({
      "review-epic": ["epic"],
      "work-epic": ["epic"],
      "work-quest": ["quest"],
      "work-feedback": ["feedback-item"],
      triage: ["feedback"],
      "work-loose-quests": ["quests"],
      "weekly-status": [],
      "review-pr": [],
      "security-check": [],
      "dependency-update": [],
    });
    // Each default is a registered page, and a view's item fills the arg.
    const pages = new Map(answer.pages.map((it) => [it.key, it]));
    for (const builtin of registry.all()) {
      for (const pin of builtin.pins ?? []) {
        const page = pages.get(pin);
        expect(page, `${builtin.name} on ${pin}`).toBeDefined();
        if (page?.gives) {
          expect(builtin.args.map((it) => it.type)).toContain(page.gives);
        } else {
          expect(builtin.args).toEqual([]);
        }
      }
    }

    // A row written for something else still takes the default pins.
    await controller.updatePrompt.run(
      {
        params: { projectId: project.id, name: "work-quest" },
        body: { enabled: false },
      },
      { user: owner },
    );
    expect((await list()).find((it) => it.name === "work-quest")?.pins).toEqual(
      ["quest"],
    );

    // Unpinned from every page: the stored [] wins, read after read.
    const unpinned = await controller.updatePrompt.run(
      {
        params: { projectId: project.id, name: "work-quest" },
        body: { pins: [] },
      },
      { user: owner },
    );
    expect(unpinned.pins).toEqual([]);
    expect((await list()).find((it) => it.name === "work-quest")?.pins).toEqual(
      [],
    );
    // A custom prompt starts pinned nowhere.
    await controller.createPrompt.run(
      {
        params: { projectId: project.id },
        body: { name: "nightly", text: "List the open quests." },
      },
      { user: owner },
    );
    expect((await list()).find((it) => it.name === "nightly")?.pins).toEqual(
      [],
    );
  });

  it("lists the ten built-ins with their args and accepted statuses, and leaves out one the project cannot use", async ({
    expect,
  }) => {
    const items = await list();
    expect(items.map((it) => it.name)).toEqual([
      "review-epic",
      "work-epic",
      "work-quest",
      "work-feedback",
      "triage",
      "work-loose-quests",
      "weekly-status",
      "review-pr",
      "security-check",
      "dependency-update",
    ]);
    const byName = Object.fromEntries(items.map((it) => [it.name, it]));
    expect(byName["review-epic"]!.args).toEqual([
      { name: "epic", type: "epic", accepts: ["draft", "ready"] },
    ]);
    expect(byName["work-quest"]).toMatchObject({
      builtin: true,
      source: "write",
      permission: "quest:update",
      timeoutSeconds: 3600,
    });
    expect(byName["work-quest"]!.text).toContain("{{quest.reference}}");
    expect(byName["work-quest"]!.text).not.toContain("{{reference}}");
    expect(byName["review-pr"]!.args).toEqual([
      { name: "pullRequest", type: "pullRequest" },
    ]);

    const narrow = await createTestProject(alepha, {
      capabilities: [
        { key: "plan", options: { epics: false, feedback: false } },
        { key: "prompts" },
      ],
    });
    await createTestMember(alepha, narrow, owner.id);
    const names = (await list(narrow.id)).map((it) => it.name);
    expect(names).not.toContain("review-epic");
    expect(names).not.toContain("triage");
    expect(names).toContain("work-quest");
    await expect(
      controller.renderPrompt.run(
        {
          params: { projectId: narrow.id, name: "triage" },
          body: { args: {} },
        },
        { user: owner },
      ),
    ).rejects.toThrow("needs a capability");
  });

  it("tells every work prompt to comment on a quest not fully done and tag it needs-answer when it asks (#Q4279)", async ({
    expect,
  }) => {
    const byName = Object.fromEntries(
      (await list()).map((it) => [it.name, it]),
    );
    for (const name of [
      "work-quest",
      "work-epic",
      "work-loose-quests",
      "work-feedback",
    ]) {
      expect(byName[name]!.text).toContain("## A quest not fully done");
      expect(byName[name]!.text).toContain("`needs-answer`");
    }
    expect(byName["work-loose-quests"]!.text).toContain(
      "not tagged `needs-human`",
    );
    expect(byName["work-epic"]!.text).toContain("whatever its tags");
    expect(byName.triage!.text).not.toContain("Build automation");
    expect(byName.triage!.text).toContain("It is not `needs-answer`");
  });

  it("hands a quest left on a question back to todo, and has a run of loose quests reread the needs-answer ones (#Q4347)", async ({
    expect,
  }) => {
    const byName = Object.fromEntries(
      (await list()).map((it) => [it.name, it]),
    );
    for (const name of [
      "work-quest",
      "work-epic",
      "work-loose-quests",
      "work-feedback",
    ]) {
      const text = byName[name]!.text;
      // The shared rule, then each prompt's own stop rule.
      expect(text).toContain(
        "hand it back with `quest_unassign` once the comment and the tag are written, so it reads `todo` again",
      );
      expect(text).not.toContain("unless you stop on");
      expect(text).not.toContain("still open, unless");
    }
    const loose = byName["work-loose-quests"]!.text;
    // A tagged quest is no longer skipped on its tag alone.
    expect(loose).not.toContain(
      "or tagged `needs-answer`, stays in `todo` and does not count",
    );
    expect(loose).toContain(
      "A quest tagged `needs-answer` is read every round, never skipped on its tag",
    );
    // One an earlier run left accepted is found too.
    expect(loose).toContain('status "in_progress" and that tag');
  });

  it("has every work prompt review its pull request with a sub-agent before it may merge, and lets a blocked quest not hold a run back (#Q4332)", async ({
    expect,
  }) => {
    const byName = Object.fromEntries(
      (await list()).map((it) => [it.name, it]),
    );
    for (const name of ["work-quest", "work-epic", "work-loose-quests"]) {
      const text = byName[name]!.text;
      expect(text).toContain(
        "## The review, before the pull request may merge",
      );
      expect(text).toContain("Never your own reasoning");
      expect(text).toContain("what the review found and what you fixed");
    }
    // The review comes before ready, and before auto-merge.
    const loose = byName["work-loose-quests"]!.text;
    expect(loose).toContain(
      "this run left with a comment and those tagged `needs-answer`, review the pull request (below), then mark it ready",
    );
    expect(loose).not.toContain("If it is empty, mark the pull request ready");
    expect(byName["work-epic"]!.text).toContain(
      "does not hold the pull request back",
    );
    expect(byName["work-quest"]!.text).toContain(
      "turn it on once the review's fixes are pushed",
    );
  });

  it("freezes a built-in's words, while its source is the project's to change, on a row of its own", async ({
    expect,
  }) => {
    const update = (body: Record<string, unknown>) =>
      controller.updatePrompt.run(
        { params: { projectId: project.id, name: "review-pr" }, body },
        { user: owner },
      );
    await expect(update({ text: "Mine" })).rejects.toThrow(
      "its text cannot change",
    );
    await expect(update({ title: "Mine" })).rejects.toThrow("its title");
    const changed = await update({ source: "write", ref: "main" });
    expect(changed).toMatchObject({
      builtin: true,
      source: "write",
      ref: "main",
    });
    expect(changed.text).toBe(registry.get("review-pr")!.text);
    const stored = await rows.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(stored).toEqual([
      expect.objectContaining({
        name: "review-pr",
        builtin: true,
        source: "write",
      }),
    ]);
    expect(stored[0]!.text).toBeUndefined();
    await expect(
      controller.deletePrompt.run(
        { params: { projectId: project.id, name: "review-pr" } },
        { user: owner },
      ),
    ).rejects.toThrow("cannot be deleted");
  });

  it("creates, edits and deletes a custom prompt, checking its name, args and placeholders", async ({
    expect,
  }) => {
    const create = (body: Record<string, unknown>) =>
      controller.createPrompt.run(
        { params: { projectId: project.id }, body: body as never },
        { user: owner },
      );
    await expect(create({ name: "work-quest", text: "Hi" })).rejects.toThrow(
      "built-in prompt's name",
    );
    await expect(
      create({ name: "crash", text: "Look at {{quest.title}}" }),
    ).rejects.toThrow("declares no arg 'quest'");
    await expect(
      create({
        name: "crash",
        text: "Hi",
        args: [{ name: "quest", type: "quest", accepts: ["ready"] }],
      }),
    ).rejects.toThrow("not 'ready'");
    await expect(
      create({
        name: "crash",
        text: "{{quest.name}}",
        args: [{ name: "quest", type: "quest" }],
      }),
    ).rejects.toThrow("not 'name'");

    const created = await create({
      name: "crash",
      title: "Investigate a crash",
      text: "Investigate {{quest.reference}} in {{project}}.",
      args: [{ name: "quest", type: "quest", accepts: ["todo"] }],
      source: "read",
    });
    expect(created).toMatchObject({
      name: "crash",
      builtin: false,
      source: "read",
      permission: "host:update",
      timeoutSeconds: 1800,
      createdBy: owner.id,
    });
    await expect(create({ name: "crash", text: "Again" })).rejects.toThrow(
      "already exists",
    );
    const edited = await controller.updatePrompt.run(
      {
        params: { projectId: project.id, name: "crash" },
        body: { text: "Look at {{quest.title}}.", enabled: false },
      },
      { user: owner },
    );
    expect(edited).toMatchObject({
      text: "Look at {{quest.title}}.",
      enabled: false,
    });
    expect((await list()).at(-1)!.name).toBe("crash");
    await controller.deletePrompt.run(
      { params: { projectId: project.id, name: "crash" } },
      { user: owner },
    );
    expect((await list()).map((it) => it.name)).not.toContain("crash");
  });

  it("duplicates a built-in into a custom prompt with the same text, args, accepted statuses and source", async ({
    expect,
  }) => {
    const copy = await controller.duplicatePrompt.run(
      {
        params: { projectId: project.id, name: "work-quest" },
        body: { name: "my-work" },
      },
      { user: owner },
    );
    const original = (await list()).find((it) => it.name === "work-quest")!;
    expect(copy).toMatchObject({
      name: "my-work",
      builtin: false,
      title: original.title,
      text: original.text,
      args: original.args,
      source: "write",
    });
  });

  it("renders a prompt with its args read from the project, and refuses an item its arg does not accept", async ({
    expect,
  }) => {
    const todo = await createTestQuest(alepha, project, {
      title: "Fix {{quest.url}} handling",
    });
    const { text } = await render("work-quest", { quest: `#Q${todo.shortId}` });
    expect(text).toContain(`Work on quest #Q${todo.shortId}`);
    // A placeholder inside a value is never expanded.
    expect(text).toContain('"Fix {{quest.url}} handling"');
    expect(text).toContain(`/quests/${todo.shortId}`);
    expect(text).toContain('Lore project "Acme"');

    const done = await createTestQuest(alepha, project, {
      acceptedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    await expect(
      render("work-quest", { quest: String(done.shortId) }),
    ).rejects.toThrow("accepts a quest todo or in_progress");
    await expect(render("work-quest", {})).rejects.toThrow(
      "The arg 'quest' (quest) is missing",
    );
    await expect(render("work-quest", { quest: "9999" })).rejects.toThrow(
      "no quest 9999",
    );

    const completed = await createTestEpic(alepha, project, {
      status: "completed",
    });
    await expect(
      render("review-epic", { epic: `#E${completed.number}` }),
    ).rejects.toThrow("accepts a epic draft or ready");
    const draft = await createTestEpic(alepha, project, { title: "Big plan" });
    expect(
      (await render("review-epic", { epic: String(draft.number) })).text,
    ).toContain(`Review the plan of epic #E${draft.number} "Big plan"`);

    const pr = await render("review-pr", { pullRequest: "42" });
    expect(pr.text).toContain("gh pr diff 42");
  });

  it("fills a member arg with the caller when it is left out", async ({
    expect,
  }) => {
    await controller.createPrompt.run(
      {
        params: { projectId: project.id },
        body: {
          name: "mail-me",
          text: "Write to {{member.name}} ({{member.id}}).",
          args: [{ name: "member", type: "member" }],
        },
      },
      { user: owner },
    );
    const { text } = await render("mail-me", {});
    expect(text).toContain(`(${owner.id})`);
  });

  it("is written with prompt:manage, which the Admin holds and a Member does not, and read and rendered by every member", async ({
    expect,
  }) => {
    expect(LorePermissions.OWNER_TODAY).toContain("prompt:manage");
    expect(LorePermissions.MEMBER_DEFAULT).not.toContain("prompt:manage");
    const user = await entities.users.create({});
    await createTestMember(alepha, project, user.id, { rank: "member" });
    const member: UserAccountToken = { id: user.id, roles: ["user"] };
    expect(
      (
        await controller.listPrompts.run(
          { params: { projectId: project.id } },
          { user: member },
        )
      ).items.length,
    ).toBe(10);
    expect((await render("triage", {}, member)).text).toContain(
      "Triage the whole feedback inbox",
    );
    await expect(
      controller.createPrompt.run(
        {
          params: { projectId: project.id },
          body: { name: "mine", text: "Hi" },
        },
        { user: member },
      ),
    ).rejects.toThrow();
  });

  it("moves prompts in a project merge: a custom name the target uses is renamed, the target's built-in row stands", async ({
    expect,
  }) => {
    const source = await createTestProject(alepha);
    for (const projectId of [project.id, source.id]) {
      await rows.create({ projectId, name: "nightly", text: "Hi" });
      await rows.create({
        projectId,
        name: "work-quest",
        builtin: true,
        source: projectId === project.id ? "read" : "none",
      });
    }
    await merge.merge(source.id, project.id);
    const merged = await rows.findMany({
      where: { projectId: { eq: project.id } },
    });
    expect(merged.map((it) => it.name).sort()).toEqual([
      "nightly",
      "nightly-2",
      "work-quest",
    ]);
    expect(merged.find((it) => it.name === "work-quest")!.source).toBe("read");
  });
});
