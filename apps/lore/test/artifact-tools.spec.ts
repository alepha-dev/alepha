import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp, type ToolPrimitive } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ArtifactController } from "../src/api/controllers/ArtifactController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { ArtifactTools } from "../src/mcp/tools/ArtifactTools.ts";
import { packedArtifact } from "./fixtures/artifactTarball.ts";

/**
 * The registry over MCP: what has this project built, and is the tag I am
 * about to write down real.
 *
 * The second question is the one worth a tool. A release and its builds are
 * joined by TAG EQUALITY, with no join table and no foreign key, so a typo
 * fails nowhere - it produces a release that will never show a build, forever.
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

  const tools = alepha.inject(ArtifactTools);
  const artifactApi = alepha.inject(ArtifactController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;
  const stranger = await users.createUser({ username: "stranger" });

  /*
    The caller's identity does NOT travel as an argument - the controllers
    behind these tools read it from the request context - so the call has to
    happen inside one, with the user seeded where `$secure` looks.
  */
  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  // Through the controller, not by inserting a row: ownership lives in a
  // membership record, and `resolveProjectId` looks the project up among the
  // ones the caller belongs to.
  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const push = async (over: {
    app?: string;
    tag?: string;
    runtime?: string;
    commitSha?: string;
    filler?: string;
  }) => {
    // Built BEFORE entering the context: `asUser` takes a synchronous thunk,
    // so an `await` inside it would need the thunk to be async and the
    // identity would then be seeded in a different tick from the call.
    const file = await packedArtifact({
      manifest: { version: 1, runtime: over.runtime ?? "node" },
      filler: over.filler,
    });

    return asUser(OWNER, () =>
      artifactApi.pushArtifact({
        params: { projectId: project.id },
        body: {
          app: over.app ?? "my-app",
          tag: over.tag ?? "1.2.3",
          commitSha: over.commitSha,
          file,
        },
      } as any),
    );
  };

  return { alepha, tools, project, call, push, stranger: stranger.id };
};

describe("Lore MCP — artifacts", () => {
  describe("artifact_list", () => {
    /**
     * The property the whole `(app, tag, runtime)` key exists for. An agent
     * reading a flat list would report one release as two.
     */
    it("folds every runtime of a tag into one entry", async () => {
      const ctx = await setup();
      await ctx.push({ runtime: "node" });
      await ctx.push({ runtime: "workerd" });

      const res: any = await ctx.call(ctx.tools.artifact_list, {
        project: ctx.project.id,
      });

      expect(res.artifacts).toHaveLength(1);
      expect(res.artifacts[0].tag).toBe("1.2.3");
      expect(res.artifacts[0].variants.map((v: any) => v.runtime)).toEqual([
        "node",
        "workerd",
      ]);
      expect(res.truncated).toBe(false);
    });

    it("narrows by app and by tag", async () => {
      const ctx = await setup();
      await ctx.push({ app: "my-app", tag: "1.2.3" });
      await ctx.push({ app: "my-docs", tag: "2.0.0", filler: "// docs" });

      const byApp: any = await ctx.call(ctx.tools.artifact_list, {
        project: ctx.project.id,
        app: "my-docs",
      });
      expect(byApp.artifacts.map((a: any) => a.app)).toEqual(["my-docs"]);

      const byTag: any = await ctx.call(ctx.tools.artifact_list, {
        project: ctx.project.id,
        tag: "1.2.3",
      });
      expect(byTag.artifacts.map((a: any) => a.app)).toEqual(["my-app"]);
    });

    /**
     * ⚠️ A tarball is megabytes and an MCP response is a token budget. Neither
     * tool may ever carry the body, and `fileId` is not published either: it
     * is how Lore stores the bytes, not how a caller addresses them.
     */
    it("never returns the body, nor a handle to it", async () => {
      const ctx = await setup();
      await ctx.push({});

      const res: any = await ctx.call(ctx.tools.artifact_list, {
        project: ctx.project.id,
      });

      const variant = res.artifacts[0].variants[0];
      expect(variant.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect("fileId" in variant).toBe(false);
      expect(JSON.stringify(res)).not.toContain("H4sI");
    });

    it("answers a project with no builds as empty, not as an error", async () => {
      const ctx = await setup();

      const res: any = await ctx.call(ctx.tools.artifact_list, {
        project: ctx.project.id,
      });

      expect(res.artifacts).toEqual([]);
    });

    it("refuses a caller who is not a member", async () => {
      const ctx = await setup();

      await expect(
        ctx.call(
          ctx.tools.artifact_list,
          { project: ctx.project.id },
          ctx.stranger,
        ),
      ).rejects.toThrowError();
    });
  });

  describe("artifact_get", () => {
    it("returns every variant when no runtime is named", async () => {
      const ctx = await setup();
      await ctx.push({ runtime: "node", commitSha: "0b35cb375" });
      await ctx.push({ runtime: "workerd" });

      const res: any = await ctx.call(ctx.tools.artifact_get, {
        project: ctx.project.id,
        app: "my-app",
        tag: "1.2.3",
      });

      expect(res.artifact.variants).toHaveLength(2);
      expect(res.artifact.tag).toBe("1.2.3");
    });

    it("narrows to one build when a runtime is named", async () => {
      const ctx = await setup();
      await ctx.push({ runtime: "node" });
      await ctx.push({ runtime: "workerd" });

      const res: any = await ctx.call(ctx.tools.artifact_get, {
        project: ctx.project.id,
        app: "my-app",
        tag: "1.2.3",
        runtime: "workerd",
      });

      expect(res.artifact.variants).toHaveLength(1);
      expect(res.artifact.variants[0].runtime).toBe("workerd");
      expect(res.artifact.variants[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    /**
     * "1.2.3 has no workerd build" is almost always answered by "it was built
     * for something else", so the refusal names what does exist rather than
     * making that a second round trip.
     */
    it("names the runtimes that do exist when the one asked for does not", async () => {
      const ctx = await setup();
      await ctx.push({ runtime: "node" });

      await expect(
        ctx.call(ctx.tools.artifact_get, {
          project: ctx.project.id,
          app: "my-app",
          tag: "1.2.3",
          runtime: "workerd",
        }),
      ).rejects.toThrowError(/node/);
    });

    it("404s a tag that was never pushed", async () => {
      const ctx = await setup();
      await ctx.push({ tag: "1.2.3" });

      await expect(
        ctx.call(ctx.tools.artifact_get, {
          project: ctx.project.id,
          app: "my-app",
          tag: "9.9.9",
        }),
      ).rejects.toThrowError(/9\.9\.9/);
    });

    /**
     * ⚠️ Case-sensitive on purpose: the tag is the join key to `releases.tag`,
     * which CI derives from a git tag byte for byte.
     */
    it("does not match a tag that differs only in case", async () => {
      const ctx = await setup();
      await ctx.push({ tag: "RC1" });

      await expect(
        ctx.call(ctx.tools.artifact_get, {
          project: ctx.project.id,
          app: "my-app",
          tag: "rc1",
        }),
      ).rejects.toThrowError();
    });
  });

  /**
   * Pushing is CI's job and the credential for it lives in CI. A tool that
   * uploaded a tarball out of an agent session would be a surface with no
   * caller, holding a project-wide credential.
   */
  it("exposes no push tool", async () => {
    const ctx = await setup();

    // The registered primitives, not the class's own property names: what the
    // container publishes is what an agent can call, and a field holding an
    // injected controller is neither.
    const registered = ctx.alepha
      .primitives<ToolPrimitive<any>>("$tool")
      .map((tool) => tool.name)
      .filter((name) => name.startsWith("artifact"));

    expect(registered.sort()).toEqual(["artifact_get", "artifact_list"]);
  });
});
