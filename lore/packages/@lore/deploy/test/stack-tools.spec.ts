import type { Alepha } from "alepha";
import { AlephaMcp } from "alepha/mcp";
import { currentUserAtom } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  EstateController,
  StackController,
  StackVariableController,
} from "../src/api/index.ts";
import { LoreDeployMcp, StackTools } from "../src/mcp/index.ts";
import {
  bootStackSpec,
  createEnvironment,
  createStack,
  newUser,
  stackWorld,
  type StackWorld,
} from "./support/stackWorld.ts";

/**
 * Stacks for agents (#Q2697): the tools read and drive stacks through the
 * HTTP actions, so they carry the same gates, and no result ever holds a
 * variable or credential value.
 */
describe("stack MCP tools", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec((a) => {
      a.with(AlephaMcp);
      a.with(LoreDeployMcp);
    });
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const as = <R>(user: { id: string }, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, {
        id: user.id,
        roles: ["user"],
      } as never);
      return fn();
    });

  const call = (
    user: { id: string },
    tool: keyof StackTools,
    params: Record<string, unknown>,
  ) =>
    as(user, () =>
      (
        alepha.inject(StackTools)[tool] as unknown as {
          execute: (p: unknown) => Promise<any>;
        }
      ).execute(params),
    );

  const arrange = async () => {
    const w = await stackWorld(alepha);
    const minted = (
      await alepha
        .inject(EstateController)
        .createEstate.fetch(
          { body: { slug: `bay-${crypto.randomUUID().slice(0, 6)}` } },
          { user: w.user },
        )
    ).data;
    await w.rows.estates.updateById(minted.id, { deployAllowed: true });
    await w.rows.grants.create({
      estateId: minted.id,
      projectId: w.project.id,
    } as never);
    const stack = await createStack(alepha, w, {
      name: "umami",
      estateId: minted.id,
    });
    const env = await createEnvironment(alepha, w, stack.id, {
      env: "production",
    });
    await alepha.inject(StackVariableController).setStackVariable.fetch(
      {
        params: {
          projectId: w.project.id,
          stackId: stack.id,
          environmentId: env.id,
        },
        body: { key: "DB_PASSWORD", value: "a-value-no-tool-may-return" },
      },
      { user: w.user },
    );
    await alepha.inject(StackController).uploadStackRevision.fetch(
      {
        params: { projectId: w.project.id, stackId: stack.id },
        body: {
          file: new File(
            [
              "services:\n  db:\n    image: postgres:17-alpine\n    environment:\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n",
            ],
            "compose.yml",
          ),
        },
      },
      { user: w.user },
    );
    return { w, stack, env };
  };

  const project = (w: StackWorld) => ({ project: w.project.id });

  it("lists stacks and reads one, with services and deploys, and never a value", async ({
    expect,
  }) => {
    const { w } = await arrange();
    const listed = await call(w.user, "stack_list", project(w));
    expect(listed.stacks.map((s: { name: string }) => s.name)).toEqual([
      "umami",
    ]);

    await call(w.user, "stack_deploy", {
      ...project(w),
      stack: "umami",
      env: "production",
    });
    await w.rows.environments.updateById(
      (await w.rows.environments.findMany({}))[0].id,
      { revision: 1 },
    );
    const got = await call(w.user, "stack_get", {
      ...project(w),
      stack: "umami",
      env: "production",
    });
    expect(got.environments[0].services).toEqual([
      { name: "db", kind: "service", image: "postgres:17-alpine" },
    ]);
    expect(got.environments[0].deploys[0]).toMatchObject({
      revision: 1,
      status: "queued",
    });
    expect(JSON.stringify([listed, got])).not.toContain(
      "a-value-no-tool-may-return",
    );
  });

  it("deploys and rolls back through the same gates as the API", async ({
    expect,
  }) => {
    const { w } = await arrange();
    const deployed = await call(w.user, "stack_deploy", {
      ...project(w),
      stack: "umami",
      env: "production",
    });
    expect(deployed).toMatchObject({ kind: "stack", status: "queued" });
    const rolled = await call(w.user, "stack_rollback", {
      ...project(w),
      stack: "umami",
      env: "production",
      revision: 1,
    });
    expect(rolled.kind).toBe("stack");

    const stranger = await newUser(alepha);
    await expect(
      call(stranger, "stack_deploy", {
        ...project(w),
        stack: "umami",
        env: "production",
      }),
    ).rejects.toThrow();
    await expect(call(stranger, "stack_list", project(w))).rejects.toThrow();
  });

  it("asks for a service's logs, then reads the request back", async ({
    expect,
  }) => {
    const { w } = await arrange();
    const asked = await call(w.user, "stack_logs", {
      ...project(w),
      stack: "umami",
      env: "production",
      service: "db",
    });
    expect(asked.status).toBe("pending");
    const command = await w.rows.commands.getOne({
      where: { id: { eq: asked.request } },
    });
    expect(command.payload).toMatchObject({
      app: "umami.db",
      environment: "production",
    });
    const read = await call(w.user, "stack_logs", {
      ...project(w),
      stack: "umami",
      env: "production",
      request: asked.request,
    });
    expect(read.status).not.toBe("done");
    await expect(
      call(w.user, "stack_logs", {
        ...project(w),
        stack: "umami",
        env: "production",
        service: "../etc",
      }),
    ).rejects.toThrow("not a service name");
  });
});
