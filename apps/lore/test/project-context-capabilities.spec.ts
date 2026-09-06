import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { FolioController } from "@/api/controllers/FolioController.ts";
import { ProjectController } from "@/api/controllers/ProjectController.ts";
import { LoreApi } from "@/api/index.ts";
import { LoreMcp } from "@/mcp/index.ts";
import { ProjectTools } from "@/mcp/tools/ProjectTools.ts";
import { QuestTools } from "@/mcp/tools/QuestTools.ts";

/**
 * `project_context` tells the truth about what a project is.
 *
 * ⚠️ **Omitted, never emptied.** An agent reading `epics: []` on a
 * Knowledge-only project concludes the project tracks epics and has none yet,
 * which is a different answer from "this project does not do that" and leads
 * it to file one. Absence is the only encoding that cannot be misread, and it
 * is why every capability-owned section on the result schema is `.optional()`
 * rather than defaulted.
 *
 * The second half is the bill. This call is paid on every session start, and
 * its own description has always claimed "~2K tokens" - a claim made when
 * every project had every section. The last case measures what a
 * Knowledge-only project actually costs, so the claim is a number somebody
 * checked rather than a round one somebody liked.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const projectTools = alepha.inject(ProjectTools);
  const questTools = alepha.inject(QuestTools);
  const projectApi = alepha.inject(ProjectController);
  const folioApi = alepha.inject(FolioController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asUser = <R>(fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, {
        id: owner.id,
        roles: ["user"],
      } as never);
      return fn();
    });

  return { alepha, projectTools, questTools, projectApi, folioApi, asUser };
};

describe("project_context and capabilities", () => {
  it("omits every section a Knowledge-only project does not own", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: { title: "Notes", capabilities: [{ key: "knowledge" }] },
      }),
    );

    const context = await ctx.asUser(() =>
      ctx.projectTools.project_context.execute({ project: project.id }),
    );

    expect(context.capabilities.map((it) => it.key)).toEqual(["knowledge"]);
    // Work's four.
    expect(context.areas).toBeUndefined();
    expect(context.activeQuests).toBeUndefined();
    expect(context.epics).toBeUndefined();
    expect(context.openReleases).toBeUndefined();
    // Knowledge's own are there, because it has Knowledge.
    expect(context.folios).toBeDefined();

    await ctx.alepha.stop();
  });

  it("omits the folio index on a project with no Knowledge", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: { title: "Tracker", capabilities: [{ key: "work" }] },
      }),
    );

    const context = await ctx.asUser(() =>
      ctx.projectTools.project_context.execute({ project: project.id }),
    );

    expect(context.folios).toBeUndefined();
    expect(context.pinnedFolios).toBeUndefined();
    expect(context.pinnedFoliosTruncated).toBeUndefined();
    // And Work's are all there.
    expect(context.epics).toEqual([]);
    expect(context.areas).toEqual([]);

    await ctx.alepha.stop();
  });

  it("refuses a write into a capability the project does not have", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: { title: "NoWork", capabilities: [{ key: "knowledge" }] },
      }),
    );

    // The refusal names the capability and the fix, in the shape epic phases
    // set: a refusal an agent cannot act on is a refusal it will retry.
    await expect(
      ctx.asUser(() =>
        ctx.questTools.quest_create.execute({
          project: project.id,
          title: "Should not exist",
          description: "",
          area: "general",
          priority: "medium",
        } as never),
      ),
    ).rejects.toThrow(/Plan and track work.*Turn it on in Settings/s);

    await ctx.alepha.stop();
  });

  it("still reads what a disabled capability left behind", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: { title: "Hidden", capabilities: [{ key: "knowledge" }] },
      }),
    );
    const folio = await ctx.asUser(() =>
      ctx.folioApi.create({
        body: { projectId: project.id, title: "Kept", content: "body" },
      } as never),
    );

    // Turn Knowledge off the way Settings does.
    const security = ctx.alepha.inject(
      (await import("@/api/services/ProjectSecurityService.ts"))
        .ProjectSecurityService,
    );
    const row = await security.capabilities.findOne({
      where: { projectId: { eq: project.id }, key: { eq: "knowledge" } },
    });
    await security.capabilities.deleteById(row!.id);

    // The orientation index stops advertising folios...
    const context = await ctx.asUser(() =>
      ctx.projectTools.project_context.execute({ project: project.id }),
    );
    expect(context.folios).toBeUndefined();

    // ...and the folio is still exactly where it was. Disabling HIDES; a
    // project that turns Knowledge back on has to find every folio untouched,
    // and a read refused here would make that impossible to verify.
    const kept = await ctx.asUser(() =>
      ctx.folioApi.get({ params: { id: folio.id } } as never),
    );
    expect(kept.title).toBe("Kept");

    await ctx.alepha.stop();
  });

  it("costs what its description says, for a Knowledge-only project", async ({
    expect,
  }) => {
    const ctx = await setup();
    const project = await ctx.asUser(() =>
      ctx.projectApi.createProject({
        body: { title: "Notes", capabilities: [{ key: "knowledge" }] },
      }),
    );
    for (let i = 0; i < 5; i++) {
      await ctx.asUser(() =>
        ctx.folioApi.create({
          body: {
            projectId: project.id,
            title: `Folio ${i}`,
            summary: "A short orientation line, about this long in practice.",
            content: "x".repeat(2_000),
          },
        } as never),
      );
    }

    const context = await ctx.asUser(() =>
      ctx.projectTools.project_context.execute({ project: project.id }),
    );

    // ⚠️ Characters over four, not a tokenizer. The point is the ORDER of
    // magnitude and that it cannot grow silently: five folios of orientation
    // fit in a few hundred tokens, where the tool's own description has always
    // claimed "~2K". Measured on this exact fixture: 1216 chars (~304 tokens)
    // with all four capabilities on, 947 chars (~237 tokens) with Knowledge
    // alone. The 269 characters are the four empty Work sections - an empty
    // area list, an empty epic index, an empty quest list and an empty release
    // list, each with its own key. Small in bytes, and that is the honest
    // reading: the win here is that an agent stops being told a project tracks
    // epics, not a token bill anybody would notice.
    const approxTokens = JSON.stringify(context).length / 4;
    expect(approxTokens).toBeLessThan(2_000);

    await ctx.alepha.stop();
  });
});
