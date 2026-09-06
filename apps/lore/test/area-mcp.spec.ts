import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { AreaController } from "../src/api/controllers/AreaController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { AreaService } from "../src/api/services/AreaService.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { ProjectTools } from "../src/mcp/tools/ProjectTools.ts";

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
  const projectApi = alepha.inject(ProjectController);
  const areaApi = alepha.inject(AreaController);
  const areaService = alepha.inject(AreaService);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  return {
    alepha,
    projectTools,
    projectApi,
    areaApi,
    areaService,
    owner,
    asUser,
  };
};

describe("Area over MCP", () => {
  it("hands an area's description to project_context", async () => {
    const ctx = await setup();

    const project = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectApi.createProject({ body: { title: "AreaMcp" } }),
    );

    const area = await ctx.areaService.ensureArea(project.id, "alepha/orm");
    await ctx.asUser(ctx.owner.id, () =>
      ctx.areaApi.updateArea({
        params: { id: area!.id },
        body: { description: "Entities and migrations." },
      }),
    );

    const result = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectTools.project_context.execute({ project: project.id }),
    );

    expect(result.areas).toContainEqual({
      name: "alepha/orm",
      description: "Entities and migrations.",
    });

    await ctx.alepha.stop();
  });

  it("truncates a long area description but leaves a short one untouched", async () => {
    const ctx = await setup();

    const project = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectApi.createProject({ body: { title: "AreaMcpTruncate" } }),
    );

    const longArea = await ctx.areaService.ensureArea(project.id, "long");
    const shortArea = await ctx.areaService.ensureArea(project.id, "short");

    const longDescription = "x".repeat(200);
    const shortDescription = "Entities and migrations.";

    await ctx.asUser(ctx.owner.id, () =>
      ctx.areaApi.updateArea({
        params: { id: longArea!.id },
        body: { description: longDescription },
      }),
    );
    await ctx.asUser(ctx.owner.id, () =>
      ctx.areaApi.updateArea({
        params: { id: shortArea!.id },
        body: { description: shortDescription },
      }),
    );

    const result = await ctx.asUser(ctx.owner.id, () =>
      ctx.projectTools.project_context.execute({ project: project.id }),
    );

    // `areas` is Work's, so it is absent on a project without it - and the
    // fixture below has Work, which is what makes the non-null assertion
    // honest rather than hopeful.
    const long = result.areas?.find((a) => a.name === "long");
    const short = result.areas?.find((a) => a.name === "short");

    expect(long?.description).toBe(`${"x".repeat(160)}…`);
    expect(short?.description).toBe(shortDescription);

    await ctx.alepha.stop();
  });
});
