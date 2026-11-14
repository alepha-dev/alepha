import { ProjectCapabilityController, ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";

import {
  AppController,
  LoreShipApi,
  StackController,
} from "../../src/api/index.ts";
import {
  appInstances,
  hostCommands,
  hostProjects,
  hosts,
  stackEnvironments,
  stackRevisions,
  stacks,
} from "../../src/schemas/index.ts";

/**
 * The world every stack spec starts from: an owner, a project with Apps and
 * `deploy` and `stacks` on, and repositories to arrange rows the API has no verb for.
 */
export class StackRows {
  public readonly hosts = $repository(hosts);
  public readonly grants = $repository(hostProjects);
  public readonly instances = $repository(appInstances);
  public readonly stacks = $repository(stacks);
  public readonly environments = $repository(stackEnvironments);
  public readonly revisions = $repository(stackRevisions);
  public readonly commands = $repository(hostCommands);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

export const bootStackSpec = async (
  arrange: (alepha: Alepha) => void = () => undefined,
): Promise<Alepha> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      APP_SECRET: "a-strong-and-unique-app-secret-for-tests",
    },
  });
  arrange(alepha);
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreShipApi);
  alepha.with(StackRows);
  await alepha.start();
  return alepha;
};

export interface StackWorld {
  user: { id: string; roles: string[] };
  project: { id: number; slug?: string };
  rows: StackRows;
}

export const newUser = async (alepha: Alepha) => {
  const fake = alepha.inject(FakeProvider).generate(userDataSchema);
  const created = await alepha
    .inject(AdminUserController)
    .createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
  return { id: created.data.id, roles: created.data.roles };
};

export const stackWorld = async (
  alepha: Alepha,
  options: { stacks?: boolean } = {},
): Promise<StackWorld> => {
  const user = await newUser(alepha);
  const project = (
    await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: `Stacks ${crypto.randomUUID().slice(0, 8)}` } },
        { user },
      )
  ).data;
  await alepha.inject(ProjectCapabilityController).setCapability.fetch(
    {
      params: { projectId: project.id, key: "ship" },
      body: {
        enabled: true,
        options: { deploy: true, stacks: options.stacks ?? true },
      },
    },
    { user },
  );
  return { user, project, rows: alepha.inject(StackRows) };
};

/**
 * A `bay` host owned by the world's user and lent to its project.
 */
export const lentBayHost = async (
  w: StackWorld,
  options: { deployAllowed?: boolean; lend?: boolean } = {},
) => {
  const host = await w.rows.hosts.create({
    ownerUserId: w.user.id,
    // Homed in the world's project, which its user owns (#E126).
    projectId: w.project.id,
    createdBy: w.user.id,
    slug: `bay-${crypto.randomUUID().slice(0, 6)}`,
    type: "bay",
    deployAllowed: options.deployAllowed ?? true,
  });
  if (options.lend ?? true) {
    await w.rows.grants.create({
      hostId: host.id,
      projectId: w.project.id,
    });
  }
  return host;
};

export const createInstance = async (
  alepha: Alepha,
  w: StackWorld,
  app: string,
  env: string,
) =>
  (
    await alepha
      .inject(AppController)
      .createApp.fetch(
        { params: { projectId: w.project.id }, body: { app, env } },
        { user: w.user },
      )
  ).data;

export const createStack = async (
  alepha: Alepha,
  w: StackWorld,
  body: { name?: string; hostId?: string } = {},
) =>
  (
    await alepha
      .inject(StackController)
      .createStack.fetch(
        { params: { projectId: w.project.id }, body },
        { user: w.user },
      )
  ).data;

export const createEnvironment = async (
  alepha: Alepha,
  w: StackWorld,
  stackId: string,
  body: { env: string; hostId?: string; baseDomain?: string },
) =>
  (
    await alepha
      .inject(StackController)
      .createStackEnvironment.fetch(
        { params: { projectId: w.project.id, stackId }, body },
        { user: w.user },
      )
  ).data;
