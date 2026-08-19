import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  projects: ProjectController;
  quests: QuestController;
  fake: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    fake: alepha.inject(FakeProvider),
  };
};

/**
 * Quest rich-text fields are Markdown, and Markdown about software is full of
 * angle brackets: generics, JSX, CLI placeholders. A `sanitizeHtml` helper
 * left over from the TipTap era used to delete every `<word…>` whose tag name
 * was not allow-listed — code spans and fenced blocks included — so those
 * bodies were silently truncated on write (quest #1231). The nastiest case
 * turned a shell command into a different, still-plausible one.
 *
 * These pin the round-trip. The renderer is what makes raw HTML safe here
 * (`MarkdownView` mounts no `rehype-raw`; see
 * `markdown-view-raw-html.browser.spec.tsx`), so re-adding storage-level
 * stripping to "harden" these fields is what turns these red.
 */
describe("quest markdown is stored verbatim", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const CODE_HEAVY = [
    "Signature is `Array<string>` and `Record<string, any>`.",
    "",
    'Render it with `<KanbanCard />` inside `<Button variant="ghost">`.',
    "",
    "```bash",
    'grep "^DROP TABLE" migrations/sqlite/<newest>.sql',
    "```",
    "",
    "Pass `<your-token>` as the bearer.",
  ].join("\n");

  const owner = async () => {
    const fakeUser = ctx.fake.generate(userDataSchema);
    const created = await ctx.admin.createUser.fetch(
      { body: { ...fakeUser, roles: ["user"] } },
      { user: adminUser },
    );
    return { id: created.data.id, roles: created.data.roles };
  };

  const project = async (user: { id: string; roles: string[] }) => {
    const res = await ctx.projects.createProject.fetch(
      { body: { title: "Markdown probe" } },
      { user },
    );
    return res.data.id;
  };

  it("keeps angle brackets in a description on create", async () => {
    const user = await owner();
    const projectId = await project(user);

    const res = await ctx.quests.createQuest.fetch(
      {
        body: {
          title: "Generics survive",
          description: CODE_HEAVY,
          area: "core",
          priority: "medium",
          difficulty: 2,
          projectId,
          objectives: [],
        },
      },
      { user },
    );

    expect(res.data.description).toBe(CODE_HEAVY);
  });

  it("keeps angle brackets in a description on update", async () => {
    const user = await owner();
    const projectId = await project(user);

    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          title: "Generics survive an edit",
          description: "placeholder",
          area: "core",
          priority: "medium",
          difficulty: 2,
          projectId,
          objectives: [],
        },
      },
      { user },
    );

    const updated = await ctx.quests.updateQuestById.fetch(
      {
        params: { id: created.data.id },
        body: { description: CODE_HEAVY },
      },
      { user },
    );

    expect(updated.data.description).toBe(CODE_HEAVY);
  });

  it("keeps angle brackets in a note", async () => {
    const user = await owner();
    const projectId = await project(user);

    const created = await ctx.quests.createQuest.fetch(
      {
        body: {
          title: "Notes take code too",
          description: "",
          area: "core",
          priority: "medium",
          difficulty: 2,
          projectId,
          objectives: [],
        },
      },
      { user },
    );

    const updated = await ctx.quests.updateQuestNote.fetch(
      {
        params: { id: created.data.id },
        body: { note: CODE_HEAVY },
      },
      { user },
    );

    expect(updated.data.note).toBe(CODE_HEAVY);
  });
});
