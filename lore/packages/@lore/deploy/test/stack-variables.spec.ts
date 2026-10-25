import type { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  StackComposeParser,
  StackService,
  StackVariableController,
  StackVariableService,
} from "../src/api/index.ts";
import {
  bootStackSpec,
  createEnvironment,
  createStack,
  newUser,
  stackWorld,
  type StackWorld,
} from "./support/stackWorld.ts";

/**
 * A stack environment's variables (#Q2692): sealed like app variables,
 * write-only, generated server-side on request, and a revision needing an
 * unset one is refused before anything is dispatched.
 */
describe("stack variables", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = await bootStackSpec();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const arrange = async () => {
    const w = await stackWorld(alepha);
    const stack = await createStack(alepha, w, { name: "umami" });
    const env = await createEnvironment(alepha, w, stack.id, {
      env: "production",
    });
    const params = {
      projectId: w.project.id,
      stackId: stack.id,
      environmentId: env.id,
    };
    return { w, stack, env, params };
  };

  const set = (
    w: StackWorld,
    params: object,
    body: { key: string; value?: string; generate?: number },
  ) =>
    alepha
      .inject(StackVariableController)
      .setStackVariable.fetch({ params, body } as never, { user: w.user });

  const list = async (w: StackWorld, params: object) =>
    (
      await alepha
        .inject(StackVariableController)
        .listStackVariables.fetch({ params } as never, { user: w.user })
    ).data;

  it("never answers a value, on the write or on the list, and masks only a long one", async ({
    expect,
  }) => {
    const { w, params } = await arrange();
    const written = await set(w, params, {
      key: "DB_PASSWORD",
      value: "correct-horse-battery-staple",
    });
    await set(w, params, { key: "SHORT", value: "hunter2" });
    const listed = await list(w, params);
    expect(JSON.stringify([written.data, listed])).not.toContain(
      "correct-horse",
    );
    expect(listed.items.map((i) => [i.key, i.valuePrefix])).toEqual([
      ["DB_PASSWORD", "corr"],
      ["SHORT", ""],
    ]);
  });

  it("generates a value server-side, which nobody ever sees, and the deploy opens it", async ({
    expect,
  }) => {
    const { w, env, params } = await arrange();
    const generated = (
      await set(w, params, { key: "APP_SECRET", generate: 64 })
    ).data;
    expect(generated).toMatchObject({
      key: "APP_SECRET",
      generated: true,
      valuePrefix: "",
    });
    const opened = await alepha.inject(StackVariableService).open(env.id);
    expect(opened.APP_SECRET).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      set(w, params, { key: "X", value: "v", generate: 32 }),
    ).rejects.toThrow("not both");
    await expect(set(w, params, { key: "X", generate: 8 })).rejects.toThrow();
  });

  it("keeps production's values apart from staging's", async ({ expect }) => {
    const { w, stack, params } = await arrange();
    const staging = await createEnvironment(alepha, w, stack.id, {
      env: "staging",
    });
    await set(w, params, { key: "DB_PASSWORD", value: "production-password" });
    const service = alepha.inject(StackVariableService);
    expect(await service.open(staging.id)).toEqual({});
  });

  it("refuses a revision that needs a variable this environment has not set, naming it", async ({
    expect,
  }) => {
    const { w, stack, env, params } = await arrange();
    const model = new StackComposeParser().parse(
      "services:\n  db:\n    image: postgres\n    environment:\n      A: ${DB_PASSWORD}\n      B: ${TAG:-7}\n      C: ${APP_SECRET}\n",
      [],
    );
    const variables = alepha.inject(StackVariableService);
    const row = await alepha
      .inject(StackService)
      .getEnvironment(
        await alepha.inject(StackService).get(w.project.id, stack.id),
        env.id,
      );
    await expect(variables.assertComplete(model, row, "umami")).rejects.toThrow(
      "umami/production has no value for APP_SECRET, DB_PASSWORD",
    );
    await set(w, params, { key: "DB_PASSWORD", value: "x" });
    await set(w, params, { key: "APP_SECRET", generate: 32 });
    await expect(
      variables.assertComplete(model, row, "umami"),
    ).resolves.toBeUndefined();
  });

  it("refuses a stranger's write and a malformed name", async ({ expect }) => {
    const { params } = await arrange();
    const stranger = await newUser(alepha);
    await expect(
      alepha
        .inject(StackVariableController)
        .setStackVariable.fetch(
          { params, body: { key: "A", value: "b" } } as never,
          { user: stranger },
        ),
    ).rejects.toThrow();
    const { w, params: own } = await arrange();
    await expect(set(w, own, { key: "1BAD", value: "x" })).rejects.toThrow(
      "not a variable name",
    );
  });
});
