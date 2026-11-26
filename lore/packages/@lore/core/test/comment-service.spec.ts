import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NotFoundError } from "alepha/server";
import { beforeEach, describe, it } from "vitest";

import {
  CommentService,
  LoreCoreApi,
  ProjectDeletionService,
} from "../src/api/index.ts";
import { comments } from "../src/schemas/index.ts";
import { CoreTestEntities, createTestProject } from "../src/testing/index.ts";

class Probe {
  comments = $repository(comments);
}

interface Ctx {
  alepha: Alepha;
  service: CommentService;
  probe: Probe;
  repos: CoreTestEntities;
  /**
   * The test subject's rows: subject id to the project it belongs to.
   */
  things: Map<number, number>;
}

const setup = async (): Promise<Ctx> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreCoreApi);
  const repos = alepha.inject(CoreTestEntities);
  const probe = alepha.inject(Probe);
  const service = alepha.inject(CommentService);
  const things = new Map<number, number>();
  // What a package does at start: its `load` is the cross-project guard.
  service.registerSubject({
    type: "thing",
    load: async (projectId, subjectId) => {
      if (things.get(subjectId) !== projectId) {
        throw new NotFoundError("Thing not found");
      }
      return { id: subjectId };
    },
  });
  service.registerSubject({ type: "other", load: async () => ({}) });
  await alepha.start();
  return { alepha, service, probe, repos, things };
};

/**
 * Core's shared `comments` table (#E185): a subject a package registers,
 * its thread, and the two ways a thread goes (its subject's delete, by hand,
 * and its project's, by the cascade).
 */
describe("CommentService", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  it("round-trips a comment: add, list, edit, remove", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    ctx.things.set(7, project.id);
    const file = crypto.randomUUID();

    const first = await ctx.service.add({
      type: "thing",
      projectId: project.id,
      subjectId: 7,
      authorId: project.createdBy,
      body: "First",
      attachments: [file],
    });
    await ctx.alepha.inject(DateTimeProvider).travel(1, "minute");
    const second = await ctx.service.add({
      type: "thing",
      projectId: project.id,
      subjectId: 7,
      authorId: project.createdBy,
      body: "Second",
      source: { kind: "mcp", client: "claude-code" },
    });

    expect(first).toMatchObject({
      projectId: project.id,
      subjectType: "thing",
      subjectId: 7,
      authorId: project.createdBy,
      attachments: [file],
    });
    expect(first.editedAt ?? undefined).toBeUndefined();
    expect(second.source).toEqual({ kind: "mcp", client: "claude-code" });
    expect(
      (await ctx.service.list("thing", 7)).map((comment) => comment.body),
    ).toEqual(["First", "Second"]);

    const edited = await ctx.service.edit(first.id, { body: "First, edited" });
    expect(edited.body).toBe("First, edited");
    expect(edited.editedAt).toBeTruthy();
    expect(edited.attachments).toEqual([file]);
    expect((await ctx.service.get("thing", 7, first.id)).body).toBe(
      "First, edited",
    );

    await ctx.service.remove(first.id);
    expect(
      (await ctx.service.list("thing", 7)).map((comment) => comment.id),
    ).toEqual([second.id]);
    await expect(ctx.service.get("thing", 7, first.id)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("refuses a subject of another project with its 404, and writes nothing", async ({
    expect,
  }) => {
    const mine = await createTestProject(ctx.alepha);
    const theirs = await createTestProject(ctx.alepha);
    ctx.things.set(7, theirs.id);

    await expect(
      ctx.service.add({
        type: "thing",
        projectId: mine.id,
        subjectId: 7,
        authorId: mine.createdBy,
        body: "Not mine to write on",
      }),
    ).rejects.toThrow(NotFoundError);
    expect(await ctx.probe.comments.count()).toBe(0);
  });

  it("refuses a comment of another thread, and a subject nobody registered", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    ctx.things.set(1, project.id);
    ctx.things.set(2, project.id);
    const comment = await ctx.service.add({
      type: "thing",
      projectId: project.id,
      subjectId: 1,
      authorId: project.createdBy,
      body: "On thing 1",
    });

    await expect(ctx.service.get("thing", 2, comment.id)).rejects.toThrow(
      NotFoundError,
    );
    await expect(ctx.service.list("unknown", 1)).rejects.toThrow(
      "is not registered",
    );
    expect(() =>
      ctx.service.registerSubject({ type: "thing", load: async () => ({}) }),
    ).toThrow("registered twice");
  });

  it("deletes the threads of 250 subjects in chunks, and no other thread", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);
    await ctx.probe.comments.createMany(
      ids.map((subjectId) => ({
        projectId: project.id,
        subjectType: "thing",
        subjectId,
        authorId: project.createdBy,
        body: `On ${subjectId}`,
      })),
    );
    // Same ids, another subject type: a quest and an error can share one.
    await ctx.probe.comments.create({
      projectId: project.id,
      subjectType: "other",
      subjectId: 1,
      authorId: project.createdBy,
      body: "Kept",
    });
    await ctx.probe.comments.create({
      projectId: project.id,
      subjectType: "thing",
      subjectId: 251,
      authorId: project.createdBy,
      body: "Kept too",
    });

    await ctx.service.deleteForSubjects("thing", ids);

    const left = await ctx.probe.comments.findMany({
      orderBy: [{ column: "id", direction: "asc" }],
    });
    expect(left.map((comment) => comment.body)).toEqual(["Kept", "Kept too"]);
    // Nothing to delete is no statement, not an empty `inArray`.
    await ctx.service.deleteForSubjects("thing", []);
  });

  it("goes with its project: the cascade empties the table for that project", async ({
    expect,
  }) => {
    const gone = await createTestProject(ctx.alepha);
    const kept = await createTestProject(ctx.alepha);
    ctx.things.set(1, gone.id);
    ctx.things.set(2, kept.id);
    for (const [subjectId, project] of [
      [1, gone],
      [2, kept],
    ] as const) {
      await ctx.service.add({
        type: "thing",
        projectId: project.id,
        subjectId,
        authorId: project.createdBy,
        body: "A word",
      });
    }

    await ctx.alepha
      .inject(ProjectDeletionService)
      .deleteProject(gone.id, { force: true });

    const left = await ctx.probe.comments.findMany();
    expect(left.map((comment) => comment.projectId)).toEqual([kept.id]);
  });
});
