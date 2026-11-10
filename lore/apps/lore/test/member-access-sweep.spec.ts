import { writeFileSync } from "node:fs";

import { LorePermissions, ProjectController } from "@lore/core/api";
import { CapabilityRegistry } from "@lore/core/schemas";
import { CoreTestEntities } from "@lore/core/testing";
import { Alepha, type z } from "alepha";
import { RankService } from "alepha/api/organizations";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { $action, AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterAll, beforeAll, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * Every project-scoped action, called over HTTP by a member of a project.
 *
 * The rank gates are declared one route at a time (`$ownsProject({ requires })`),
 * so a route that forgot its `requires` is invisible to every spec that tests
 * the routes it remembered. This one reads what each action DECLARES, calls it
 * with a body its schema accepts, as a member holding a given rank, and fails
 * on any action that declares a permission the rank does not grant and still
 * lets the member through.
 *
 * It runs twice: as the built-in `member` rank, and as a rank holding only the
 * floor (`project:read`), which is what reaches the gates a plain member is
 * allowed through (`quest:create`, `folio:write`...).
 *
 * `SWEEP_OUT=<dir>` writes every probe as JSON, for reading the outcome of the
 * routes the sweep could not conclude on.
 */

type Outcome = "denied" | "passed" | "inconclusive";

interface Probe {
  name: string;
  route: string;
  required: string[];
  beyond: string[];
  status: number;
  outcome: Outcome;
  message: string;
}

const PRIVILEGED = {
  id: "00000000-0000-4000-8000-0000000000aa",
  realm: "users",
  ownership: false,
} as const;

/**
 * Values a path parameter's pattern accepts, where the faker's would not.
 */
const PARAM_VALUES: Record<string, string> = {
  key: "SWEEP_VAR",
  tag: "v1",
  app: "sweep",
  env: "production",
};

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
  bootLore(alepha, ["api"]);
  const repos = alepha.inject(CoreTestEntities);
  await alepha.start();
  return {
    alepha,
    repos,
    users: alepha.inject(UserService),
    projects: alepha.inject(ProjectController),
    capabilities: alepha.inject(CapabilityRegistry),
    ranks: alepha.inject(RankService),
    faker: alepha.inject(FakeProvider),
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const statusOf = (error: unknown): number =>
  (error as { status?: number }).status ??
  (error as { cause?: { status?: number } }).cause?.status ??
  0;

const permissionsOf = (action: {
  handler: { metadata: Array<{ options?: Record<string, unknown> }> };
}): string[] =>
  action.handler.metadata.flatMap((meta) => {
    const list = (meta.options?.permissions ?? []) as Array<
      string | { group?: string; name: string }
    >;
    return list.map((it) =>
      typeof it === "string"
        ? it
        : it.group
          ? `${it.group}:${it.name}`
          : it.name,
    );
  });

const fake = (ctx: Ctx, schema: unknown, projectId: number) => {
  if (!schema) return undefined;
  let value: any;
  try {
    value = ctx.faker.generate(schema as z.ZType);
  } catch {
    value = {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("projectId" in value) value.projectId = projectId;
  }
  return value;
};

/**
 * A fresh project with every capability and every option on, and the member
 * seated at `rank` (`member` is the built-in default, stored as NULL).
 */
const freshProject = async (
  ctx: Ctx,
  memberId: string,
  rank: { key: string; permissions?: string[] },
) => {
  const capabilities = ctx.capabilities.all().map((capability) => ({
    key: capability.key,
    options: Object.fromEntries(
      capability.options.map((option) => [option.key, true]),
    ),
  }));
  // A new owner each time: an account owns at most 100 projects.
  const ownerId = (
    await ctx.users.createUser({ username: `owner-${created_count}` })
  ).id;
  const created = await ctx.projects.createProject.fetch(
    { body: { title: `Sweep ${created_count++}`, capabilities } as never },
    { user: { id: ownerId, roles: ["user"], realm: "users" } as never },
  );
  const project = (await ctx.repos.projects.findById(created.data.id))!;
  const organizationId = project.organizationId!;
  if (rank.permissions) {
    await ctx.ranks.save(
      organizationId,
      { key: rank.key, name: rank.key, permissions: rank.permissions },
      PRIVILEGED as never,
    );
  }
  await ctx.repos.members.create({
    organizationId,
    userId: memberId,
    ...(rank.key === "member" ? {} : { rank: rank.key }),
  });
  return { ...project, ownerId };
};

let created_count = 0;

const sweep = async (
  ctx: Ctx,
  rank: { key: string; permissions?: string[] },
): Promise<Probe[]> => {
  const probes: Probe[] = [];
  const member = await ctx.users.createUser({ username: `member-${rank.key}` });
  const memberToken = { id: member.id, roles: ["user"], realm: "users" };

  let project = await freshProject(ctx, member.id, rank);
  const held =
    (await ctx.ranks.permissionsOf(project.organizationId!, rank.key)) ?? [];

  for (const action of ctx.alepha.primitives($action)) {
    const path = action.path;
    const bodyShape = (action.options.schema?.body as any)?.shape;
    const queryShape = (action.options.schema?.query as any)?.shape;
    // Every action that names a resource: by a path parameter, or by a
    // `projectId` in its body or query. An `:id` that is not a project's
    // resolves to some other row, whose project this member also belongs to
    // at the same rank (every fresh project seats them), so the check holds.
    const paramsShape = (action.options.schema?.params as any)?.shape ?? {};
    const named =
      Object.keys(paramsShape).length > 0 ||
      Boolean(bodyShape?.projectId ?? queryShape?.projectId);
    if (!named) continue;

    const required = permissionsOf(action as never).filter(
      (it) => !it.startsWith("admin:"),
    );
    const beyond = required.filter((it) => !ctx.ranks.grants(held, it));

    const accepts = (key: string, value: unknown) =>
      paramsShape[key]?.safeParse?.(value)?.success === true;
    const params: Record<string, unknown> = {};
    for (const key of Object.keys(paramsShape)) {
      params[key] =
        (key === "projectId" || key === "id") && accepts(key, project.id)
          ? project.id
          : key === "organizationId"
            ? project.organizationId
            : key === "userId"
              ? project.ownerId
              : key === "key" && path.includes("/capabilities/")
                ? "work"
                : (PARAM_VALUES[key] ??
                  fake(ctx, paramsShape[key], project.id));
    }
    const body = fake(ctx, action.options.schema?.body, project.id);
    const query = fake(ctx, action.options.schema?.query, project.id);

    let status = 200;
    let message = "";
    try {
      await action.fetch(
        { params, body, query } as never,
        { user: memberToken } as never,
      );
    } catch (error) {
      status = statusOf(error);
      message = (error as Error).message?.slice(0, 200) ?? "";
    }

    const outcome: Outcome =
      status === 403
        ? "denied"
        : status === 0 ||
            status === 401 ||
            status === 404 ||
            (status === 400 && /validat|invalid|expected|parse/i.test(message))
          ? "inconclusive"
          : "passed";

    probes.push({
      name: action.name,
      route: `${action.method} ${path}`,
      required,
      beyond,
      status,
      outcome,
      message,
    });

    // A probe that got past the gates may have changed the project (deleted
    // it, removed the member, rotated something): the next one starts clean.
    if (outcome !== "denied") {
      project = await freshProject(ctx, member.id, rank);
    }
  }

  if (process.env.SWEEP_OUT) {
    writeFileSync(
      `${process.env.SWEEP_OUT}/sweep-${rank.key}.json`,
      JSON.stringify(probes, null, 1),
    );
  }
  return probes;
};

const leaksOf = (probes: Probe[]) =>
  probes
    .filter((it) => it.beyond.length > 0 && it.outcome === "passed")
    .map((it) => `${it.route} (${it.beyond.join(", ")}) -> ${it.status}`);

describe("project members, against every action that names a resource", () => {
  let ctx: Ctx;
  let member: Probe[] = [];
  let floor: Probe[] = [];

  beforeAll(async () => {
    ctx = await setup();
    member = await sweep(ctx, { key: "member" });
    floor = await sweep(ctx, {
      key: "floor",
      permissions: [...LorePermissions.FLOOR],
    });
  }, 900_000);

  afterAll(async () => {
    await ctx?.alepha.stop();
  });

  it("reaches the project-scoped surface and concludes on most of it", ({
    expect,
  }) => {
    for (const probes of [member, floor]) {
      const gated = probes.filter((it) => it.beyond.length > 0);
      const concluded = gated.filter((it) => it.outcome !== "inconclusive");
      // The rest name a row the sweep cannot fake (a quest, an app copy, an
      // estate) and answer 404 before any rank is asked. Measured 2026-11-10:
      // 370 actions, 78% concluded as the member, 66% as the floor rank.
      expect(probes.length).toBeGreaterThan(300);
      expect(concluded.length / gated.length).toBeGreaterThan(0.6);
    }
  });

  it("never lets the built-in member through an action its rank does not grant", ({
    expect,
  }) => {
    expect(leaksOf(member)).toEqual([]);
  });

  it("never lets a floor-only rank through an action its rank does not grant", ({
    expect,
  }) => {
    expect(leaksOf(floor)).toEqual([]);
  });
});
