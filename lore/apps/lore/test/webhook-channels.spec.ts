import {
  ProjectChannelController,
  ProjectEventDelivery,
  SubscriptionController,
  projectEvents,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { DeployRegistry } from "@lore/ship/api";
import { appInstances, deployments } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import {
  MemoryWebhookTransport,
  WebhookService,
  WebhookTransport,
  webhookEndpointEntity,
} from "alepha/api/webhooks";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { WebhookVerifier, type UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class QuietQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class Rows extends TestEntityRepositories {
  jobs = $repository(jobExecutionEntity);
  endpoints = $repository(webhookEndpointEntity);
  events = $repository(projectEvents);
  instances = $repository(appInstances);
  deployments = $repository(deployments);
}

const RECEIVER = "https://hooks.example.test/lore";

/**
 * Webhook channels (#Q3900): a subscription calls an endpoint of the
 * framework's `$webhook`, signed, with the project event's id as the
 * `webhook-id`.
 */
describe("Webhook channels", () => {
  let alepha: Alepha;
  let rows: Rows;
  let receiver: MemoryWebhookTransport;
  let verifier: WebhookVerifier;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let owner: UserAccountToken;
  const channels = () => alepha.inject(ProjectChannelController);
  const addWebhook = (url = RECEIVER, name = "ci") =>
    channels().createProjectChannel.fetch(
      {
        params: { projectId: project.id },
        body: { kind: "webhook", name, url },
      },
      { user: owner },
    );
  const subscribe = (channelId: string, filter?: string) =>
    alepha.inject(SubscriptionController).setSubscription.fetch(
      {
        params: { projectId: project.id },
        body: {
          event: "deploy.failed",
          channelId,
          ...(filter ? { filter } : {}),
        },
      },
      { user: owner },
    );
  const drain = async () => {
    const jobs = alepha.inject(JobProvider);
    for (const name of [ProjectEventDelivery.JOB, "system.webhooks.deliver"])
      for (const job of await rows.jobs.findMany({
        where: { jobName: name, status: "pending" },
      }))
        await jobs.processExecution(job.jobName, job.id);
  };
  const fail = async (app: string) => {
    const instance = await rows.instances.create({
      projectId: project.id,
      app,
      env: "production",
      createdBy: owner.id,
    });
    const deployment = await rows.deployments.create({
      projectId: project.id,
      instanceId: instance.id,
      app,
      tag: "latest",
      sha256: "a".repeat(64),
      status: "running",
    });
    await alepha.inject(DeployRegistry).failed(deployment.id, "Broken");
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
        APP_SECRET: "a-spec-secret-that-is-not-the-default-one",
      },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: QuietQueue })
      .with({ provide: WebhookTransport, use: MemoryWebhookTransport });
    bootLore(alepha);
    rows = alepha.inject(Rows);
    receiver = alepha.inject(MemoryWebhookTransport);
    verifier = alepha.inject(WebhookVerifier);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "ship", options: { deploy: true } }],
    });
    await createPresetRanks(alepha, project.id);
    await rows.users.updateById(project.createdBy, { roles: ["user"] });
    owner = { id: project.createdBy, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("declares the catalog's events to the framework", ({ expect }) => {
    const declared = alepha
      .inject(WebhookService)
      .list()
      .map((it) => it.name);
    expect(declared).toContain("deploy.failed");
    expect(declared).toContain("host.offline");
  });

  it("drives one project-scoped endpoint: created with its secret once, renamed, rotated, deleted", async ({
    expect,
  }) => {
    const created = (await addWebhook()).data;
    expect(created.secret).toMatch(/^whsec_/);
    expect(created).toMatchObject({ kind: "webhook", url: RECEIVER });
    const [endpoint] = await rows.endpoints.findMany({});
    expect(endpoint).toMatchObject({
      scope: `project:${project.id}`,
      url: RECEIVER,
      description: "ci",
    });
    const listed = await channels().listProjectChannels.fetch(
      { params: { projectId: project.id } },
      { user: owner },
    );
    expect(JSON.stringify(listed.data)).not.toContain(created.secret);
    await channels().updateProjectChannel.fetch(
      {
        params: { projectId: project.id, id: created.id },
        body: { name: "builds" },
      },
      { user: owner },
    );
    expect((await rows.endpoints.getById(endpoint.id)).description).toBe(
      "builds",
    );
    const rotated = (
      await channels().rotateProjectChannelSecret.fetch(
        { params: { projectId: project.id, id: created.id } },
        { user: owner },
      )
    ).data;
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(created.secret);
    await channels().deleteProjectChannel.fetch(
      { params: { projectId: project.id, id: created.id } },
      { user: owner },
    );
    expect(await rows.endpoints.count()).toBe(0);
  });

  it("sends a subscribed event, signed, with the event's id as the webhook-id, and honours the filter", async ({
    expect,
  }) => {
    const created = (await addWebhook()).data;
    await subscribe(created.id, "site");
    await fail("site");
    await fail("admin");
    await drain();
    expect(receiver.requests).toHaveLength(1);
    const [request] = receiver.requests;
    const [event] = await rows.events.findMany({
      where: { projectId: project.id, name: "deploy.failed" },
    });
    const matching = (
      await rows.events.findMany({
        where: { projectId: project.id },
      })
    ).find((it) => it.fields.app === "site")!;
    expect(request.headers["webhook-id"]).toBe(matching.id);
    expect(request.envelope).toMatchObject({
      id: matching.id,
      type: "deploy.failed",
      data: {
        project: { id: project.id },
        subject: { kind: "deployment" },
        fields: { app: "site" },
      },
    });
    expect(event).toBeDefined();
    // Throws on a bad signature: the secret shown once verifies it, and
    // another does not.
    await verifier.verify({
      headers: request.headers,
      body: request.body,
      secret: created.secret!,
    });
    await expect(
      (async () =>
        verifier.verify({
          headers: request.headers,
          body: request.body,
          secret: `whsec_${Buffer.from("x".repeat(32)).toString("base64")}`,
        }))(),
    ).rejects.toThrow();
  });

  it("reuses the event's id as the webhook-id when the delivery job runs again", async ({
    expect,
  }) => {
    const created = (await addWebhook()).data;
    await subscribe(created.id);
    await fail("site");
    const [event] = await rows.events.findMany({
      where: { projectId: project.id },
    });
    const delivery = alepha.inject(ProjectEventDelivery);
    // Two passes with no memo between them: a crash after the hand-off.
    await delivery.deliver(event, (_name, fn) => fn());
    await delivery.deliver(event, (_name, fn) => fn());
    await drain();
    const ids = receiver.requests.map((it) => it.headers["webhook-id"]);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids)).toEqual(new Set([event.id]));
  });

  it("refuses a literal private or loopback address at save and at the call", async ({
    expect,
  }) => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://[::1]/hook",
      "https://localhost/hook",
    ])
      await expect(addWebhook(url, url.slice(8, 20))).rejects.toThrow(
        /private address|local name/,
      );
    const created = (await addWebhook()).data;
    await subscribe(created.id);
    const [endpoint] = await rows.endpoints.findMany({});
    await rows.endpoints.updateById(endpoint.id, {
      url: "https://192.168.1.10/hook",
    });
    await fail("site");
    await drain();
    expect(receiver.requests).toHaveLength(0);
  });

  it("shows an endpoint the framework disabled as switched off on its channel", async ({
    expect,
  }) => {
    const created = (await addWebhook()).data;
    const [endpoint] = await rows.endpoints.findMany({});
    await rows.endpoints.updateById(endpoint.id, {
      status: "disabled",
      disabledReason: "gone",
    });
    const listed = await channels().listProjectChannels.fetch(
      { params: { projectId: project.id } },
      { user: owner },
    );
    expect(listed.data.items.find((it) => it.id === created.id)).toMatchObject({
      status: "disabled",
      disabledReason: "gone",
    });
  });
});
