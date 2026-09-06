import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { AppInstanceTools } from "../src/mcp/tools/AppInstanceTools.ts";
import { SigilTools } from "../src/mcp/tools/SigilTools.ts";

/**
 * The Apps surface over MCP: an agent is exactly where a new deployed copy
 * first appears, so it has to be able to create one.
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

  const appTools = alepha.inject(AppInstanceTools);
  const sigilTools = alepha.inject(SigilTools);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  // A real user row: membership carries a foreign key to it, so a made-up id
  // fails the constraint rather than the authorization check.
  const owner = await users.createUser({ username: "owner" });

  /*
    Runs a tool the way the transport does. `execute()` is the entry point, and
    the caller's identity does NOT travel as an argument — the controllers
    behind these tools read it from the request context.
  */
  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  const call = (tool: any, params: Record<string, unknown>) =>
    asUser(owner.id, () => tool.execute(params));

  // Created through the controller, not by inserting a row: ownership lives in
  // a membership record, and `resolveProjectId` looks the project up among the
  // ones the caller belongs to.
  const project = await asUser(owner.id, () =>
    projectApi.createProject({ body: { title: "Apps MCP" } } as any),
  );

  return { alepha, appTools, sigilTools, project, call };
};

describe("Lore MCP — app instances", () => {
  it("creates a deployed copy and mints nothing", async () => {
    const { appTools, project, call } = await setup();

    const created: any = await call(appTools.app_instance_create, {
      project: project.id,
      app: "club",
      env: "b14-production",
    });

    expect(created.app).toBe("club");
    expect(created.env).toBe("b14-production");
    expect(created.sigil).toBeUndefined();
  });

  it("offers the distinct app names beside the rows", async () => {
    // The MCP half of the create dialog's combobox: there is no app entity, so
    // `clbu` beside `club` is silently a second app and nothing complains.
    const { appTools, project, call } = await setup();
    for (const [app, env] of [
      ["club", "production"],
      ["club", "staging"],
      ["docs", "production"],
    ]) {
      await call(appTools.app_instance_create, {
        project: project.id,
        app,
        env,
      });
    }

    const listed: any = await call(appTools.app_instance_list, {
      project: project.id,
    });

    expect(listed.instances).toHaveLength(3);
    expect(listed.apps).toEqual(["club", "docs"]);
  });

  it("renames a half without touching the other", async () => {
    const { appTools, project, call } = await setup();
    await call(appTools.app_instance_create, {
      project: project.id,
      app: "club",
      env: "staging",
      url: "https://staging.club.example",
    });

    const updated: any = await call(appTools.app_instance_update, {
      project: project.id,
      app: "club",
      env: "staging",
      newEnv: "b14-staging",
    });

    expect(updated.env).toBe("b14-staging");
    expect(updated.app).toBe("club");
    expect(updated.url).toBe("https://staging.club.example");
  });

  it("takes the sigil with the instance on delete", async () => {
    const { appTools, sigilTools, project, call } = await setup();
    await call(sigilTools.sigil_create, { project: project.id, app: "club" });

    await call(appTools.app_instance_delete, {
      project: project.id,
      app: "club",
      env: "production",
    });

    const listed: any = await call(appTools.app_instance_list, {
      project: project.id,
    });
    expect(listed.instances).toHaveLength(0);
    const sigils: any = await call(sigilTools.sigil_list, {
      project: project.id,
    });
    expect(sigils.sigils).toHaveLength(0);
  });
});

describe("Lore MCP — sigils after Apps v3", () => {
  it("creates the instance when minting for one that does not exist", async () => {
    // The one tool that composes two calls, and it has to: a credential hangs
    // off a deployed copy and `createSigil` is 404 without one.
    const { appTools, sigilTools, project, call } = await setup();

    const minted: any = await call(sigilTools.sigil_create, {
      project: project.id,
      app: "club",
      env: "staging",
    });

    expect(minted.token).toMatch(/^sg_/);
    expect(minted.app).toBe("club");
    expect(minted.env).toBe("staging");
    // The name is the derived mirror, written by the server.
    expect(minted.name).toBe("club/staging");

    const listed: any = await call(appTools.app_instance_list, {
      project: project.id,
    });
    expect(listed.instances[0].sigil?.tokenPrefix).toBe(minted.tokenPrefix);
  });

  it("attaches to an instance that already exists without one", async () => {
    const { appTools, sigilTools, project, call } = await setup();
    await call(appTools.app_instance_create, {
      project: project.id,
      app: "club",
      env: "production",
      url: "https://club.example",
    });

    await call(sigilTools.sigil_create, { project: project.id, app: "club" });

    const listed: any = await call(appTools.app_instance_list, {
      project: project.id,
    });
    // One instance, not two: the tool found the existing copy rather than
    // creating a second.
    expect(listed.instances).toHaveLength(1);
    expect(listed.instances[0].url).toBe("https://club.example");
    expect(listed.instances[0].sigil).toBeTruthy();
  });

  it("defaults the env to production, and only here", async () => {
    // Safe in this tool because it CREATES the copy when it is missing, so the
    // default names one rather than guessing among several. `app_instance_create`
    // refuses to default it for exactly the opposite reason.
    const { sigilTools, project, call } = await setup();

    const minted: any = await call(sigilTools.sigil_create, {
      project: project.id,
      app: "club",
    });

    expect(minted.env).toBe("production");
  });

  it("keeps `name` working as a deprecated alias of `app`", async () => {
    // These tools are called by scripts and by other agents' saved
    // instructions, and an MCP parameter disappearing is a silent failure at
    // the far end.
    const { sigilTools, project, call } = await setup();

    const minted: any = await call(sigilTools.sigil_create, {
      project: project.id,
      name: "docs",
    });

    expect(minted.app).toBe("docs");
    expect(minted.name).toBe("docs/production");
  });

  it("refuses to mint a second credential for one copy", async () => {
    const { sigilTools, project, call } = await setup();
    await call(sigilTools.sigil_create, { project: project.id, app: "club" });

    await expect(
      call(sigilTools.sigil_create, { project: project.id, app: "club" }),
    ).rejects.toThrow(/already has a sigil/);
  });

  it("leaves the instance alive when the credential goes", async () => {
    // ⚠️ Before v3 this tool removed the app. An agent following an old note
    // must not be surprised silently.
    const { appTools, sigilTools, project, call } = await setup();
    const minted: any = await call(sigilTools.sigil_create, {
      project: project.id,
      app: "club",
    });

    await call(sigilTools.sigil_delete, {
      project: project.id,
      id: minted.id,
    });

    const listed: any = await call(appTools.app_instance_list, {
      project: project.id,
    });
    expect(listed.instances).toHaveLength(1);
    expect(listed.instances[0].sigil).toBeUndefined();
  });

  it("carries the pair on a rotated credential", async () => {
    const { sigilTools, project, call } = await setup();
    const minted: any = await call(sigilTools.sigil_create, {
      project: project.id,
      app: "club",
      env: "b14-staging",
    });

    const rotated: any = await call(sigilTools.sigil_rotate, {
      project: project.id,
      id: minted.id,
    });

    expect(rotated.token).not.toBe(minted.token);
    expect(rotated.app).toBe("club");
    expect(rotated.env).toBe("b14-staging");
  });
});
