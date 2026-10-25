import {
  AutomationClaims,
  AutomationContextBuilder,
  AutomationDomainActions,
  AutomationEvaluator,
  AutomationEvents,
  AutomationMutationContext,
  AutomationNotifications,
  AutomationPersistence,
  AutomationPresetService,
  AutomationService,
  AutomationVariableService,
} from "@lore/core/api";
import { AutomationWorker } from "@lore/core/api";
import type { AutomationResource } from "@lore/core/schemas";
import { createPresetRanks } from "@lore/core/testing";
import { DeployJobs, DeployRegistry } from "@lore/deploy/api";
import { appInstances, artifacts, deployments } from "@lore/deploy/schemas";
import { FolioController } from "@lore/knowledge/api";
import { ReleaseController } from "@lore/work/api";
import { Alepha, AlephaError, $hook, $inject } from "alepha";
import { JobQueueProvider, jobExecutionEntity } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class PublicationQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class PublicationRows {
  public readonly instances = $repository(appInstances);
  public readonly artifacts = $repository(artifacts);
  public readonly deployments = $repository(deployments);
  public readonly jobs = $repository(jobExecutionEntity);
}
class PublicationFaults {
  protected readonly mutations = $inject(AutomationMutationContext);
  public crashAfterAppend = false;
  public beforeAppend?: () => Promise<void>;
  protected readonly before = $hook({
    on: "repository:update:before",
    handler: async ({ tableName }) => {
      if (
        tableName !== "folios" ||
        !this.mutations.current ||
        !this.beforeAppend
      )
        return;
      const task = this.beforeAppend;
      this.beforeAppend = undefined;
      await task();
    },
  });
  protected readonly after = $hook({
    on: "repository:update:after",
    handler: ({ tableName }) => {
      if (
        tableName !== "folios" ||
        !this.mutations.current ||
        !this.crashAfterAppend
      )
        return;
      this.crashAfterAppend = false;
      throw new AlephaError("Interrupted after publication append committed");
    },
  });
}
class PublicationNotifications extends AutomationNotifications {
  public refuse = false;
  public override async enqueue(
    ...args: Parameters<AutomationNotifications["enqueue"]>
  ) {
    if (this.refuse)
      throw new AlephaError("Publication notification could not enqueue");
    return super.enqueue(...args);
  }
}

describe("Deployment and release publication presets", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let rows: PublicationRows;
  let faults: PublicationFaults;
  let persistence: AutomationPersistence;
  let service: AutomationService;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let time: DateTimeProvider;
  const arm = async (key: string, values: Record<string, string>) => {
    const rule = await alepha
      .inject(AutomationPresetService)
      .create(project.id, user, {
        key,
        values: { recipient: user.id, ...values },
      });
    return service.setEnabled(project.id, rule.id, user, true, 0);
  };
  const finish = async (input: { receiptId: string; token?: string }) => {
    let next: typeof input | undefined = input;
    for (let index = 0; next && index < 20; index++)
      next = await alepha.inject(AutomationWorker).step(next, 3);
    if (next)
      throw new AlephaError("Publication worker exceeded its step budget");
  };
  const dispatch = async (rule: AutomationResource) => {
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.findMany({
      where: { automationId: rule.id, kind: "occurrence", status: "ready" },
    });
    for (const receipt of ready) await finish({ receiptId: receipt.id });
    return ready;
  };
  const folio = () =>
    alepha.inject(FolioController).create(
      {
        body: {
          projectId: project.id,
          title: "Release log",
          content: "Human introduction",
        },
      },
      { user },
    );
  const release = async (tag = "1.0.0") =>
    (
      await alepha.inject(ReleaseController).createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag, title: `Release ${tag}` },
        },
        { user },
      )
    ).data;
  const publish = (id: number) =>
    alepha
      .inject(ReleaseController)
      .publishRelease.fetch({ params: { id }, body: {} }, { user });
  const notifications = () =>
    rows.jobs.findMany({ where: { jobName: "system.notifications.send" } });
  const isolate = <T>(task: () => Promise<T>) =>
    alepha.context.nest(() => {
      alepha.context.set("lore.automations.origin", undefined);
      alepha.context.set("lore.automations.mutation", undefined);
      return task();
    });
  const claimRelease = async (rule: AutomationResource) => {
    const event = await persistence.events.getOne({
      where: { projectId: project.id, name: "release.published" },
    });
    const stored = await persistence.rules.getById(rule.id);
    const evaluation = await alepha.inject(AutomationEvaluator).evaluate({
      rule: stored,
      liveSource: {
        fields: event.payload.fields,
        provenance: {
          mode: "live",
          key: event.name,
          id: event.id,
          occurredAt: event.occurredAt,
          actorUserId: user.id,
        },
      },
    });
    if (evaluation.refusal) throw new AlephaError(evaluation.refusal);
    const claimed = await alepha.inject(AutomationClaims).claim({
      automationId: rule.id,
      revision: rule.revision,
      source: { kind: "event", eventId: event.id },
      prepared: evaluation.prepared!,
    });
    if (claimed.state !== "claimed")
      throw new AlephaError("Could not claim publication");
    return {
      occurrence: claimed.receipt!,
      context: await alepha
        .inject(AutomationContextBuilder)
        .source(project.id, "release.published", event.payload.fields),
    };
  };
  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: PublicationQueue })
      .with({
        provide: AutomationNotifications,
        use: PublicationNotifications,
      });
    bootLore(alepha);
    entities = alepha.inject(TestEntityRepositories);
    rows = alepha.inject(PublicationRows);
    faults = alepha.inject(PublicationFaults);
    persistence = alepha.inject(AutomationPersistence);
    service = alepha.inject(AutomationService);
    time = alepha.inject(DateTimeProvider);
    await alepha.start();
    time.pause();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "work", options: { automations: true, releases: true } },
        { key: "knowledge" },
        { key: "apps", options: { deploy: true } },
      ],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("alerts on persisted app failures across environments, including timeouts, without logs or cancellation", async ({
    expect,
  }) => {
    const production = await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "production",
    });
    const preview = await rows.instances.create({
      projectId: project.id,
      app: "site",
      env: "preview",
    });
    const another = await rows.instances.create({
      projectId: project.id,
      app: "other",
      env: "production",
    });
    const rule = await arm("deploy-failed", { app: "site" });
    const artifact = await rows.artifacts.create({
      projectId: project.id,
      app: "site",
      tag: "latest",
      runtime: "node",
      sha256: "a".repeat(64),
    });
    const deployment = (
      instanceId: string,
      app = "site",
      extra: Record<string, string> = {},
    ) =>
      rows.deployments.create({
        projectId: project.id,
        instanceId,
        app,
        artifactId: artifact.id,
        tag: "latest",
        sha256: "a".repeat(64),
        status: "running",
        ...extra,
      });
    const failed = await deployment(preview.id);
    await alepha
      .inject(DeployRegistry)
      .failed(failed.id, "Authorization: Bearer SECRET; PRIVATE LOGS");
    await alepha.inject(DeployRegistry).failed(failed.id, "repeat");
    const stale = time.now().subtract(2, "hours").toISOString();
    const timedOut = await deployment(production.id, "site", {
      startedAt: stale,
      createdAt: stale,
    });
    await alepha.inject(DeployJobs).sweepAbandoned.trigger();
    const cancelled = await deployment(production.id);
    await alepha.inject(DeployRegistry).cancelled(cancelled.id);
    const ignored = await deployment(another.id, "other");
    await alepha.inject(DeployRegistry).failed(ignored.id, "Other app");
    await rows.artifacts.updateById(artifact.id, { sha256: "b".repeat(64) });
    await rows.artifacts.deleteById(artifact.id);
    expect(await dispatch(rule)).toHaveLength(2);
    const jobs = await notifications();
    expect(jobs).toHaveLength(2);
    const text = JSON.stringify(jobs.map((job) => job.payload!.variables));
    expect(text).toContain(failed.id);
    expect(text).toContain(timedOut.id);
    expect(text).toContain("preview");
    expect(text).toContain("production");
    expect(text).toContain("latest");
    expect(text).toContain("a".repeat(64));
    expect(text).toContain("Deployment stopped reporting");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("PRIVATE LOGS");
    expect(text).not.toContain(cancelled.id);
    expect(text).not.toContain(ignored.id);
    expect(text).not.toContain("b".repeat(64));
    await expect(
      arm("deploy-failed", { app: "not-in-project" }),
    ).rejects.toThrow("App does not exist in this project");
  });
  for (const channel of ["inbox", "email"]) {
    it(`appends frozen publication content once, then enqueues ${channel} in the releases category`, async ({
      expect,
    }) => {
      await entities.users.updateById(user.id, {
        email: "author@example.test",
      });
      const target = await folio();
      let rule = await arm("release-to-folio", { folio: target.id, channel });
      const variables = alepha.inject(AutomationVariableService);
      await variables.set(project.id, user, "release_log", {
        value: { kind: "folio", value: target.id },
      });
      await variables.set(project.id, user, "release_recipient", {
        value: { kind: "member", value: user.id },
      });
      const configured = rule.rule!;
      rule = await service.update(project.id, rule.id, user, rule.revision, {
        title: rule.title,
        rule: {
          ...configured,
          actions: [
            {
              ...configured.actions[0],
              kind: "appendFolio",
              folio: "{{release_log}}",
              text: "## {{release_tag}}: {{title}}\n\n{{changelog}}\n\nQuests: {{quest_count}}.",
            },
            {
              ...configured.actions[1],
              kind: "notify",
              recipient: "{{release_recipient}}",
              channel,
              title: "Release published: {{release_tag}}",
              text: "{{title}}",
              category: "releases",
            },
          ],
        },
      });
      const published = await release();
      await createTestQuest(alepha, project, {
        releaseId: published.id,
        completedAt: time.nowISOString(),
        title: "Frozen quest title",
      });
      await publish(published.id);
      const event = await persistence.events.getOne({
        where: { name: "release.published" },
      });
      await entities.releases.updateById(published.id, {
        changelog: "CHANGED AFTER PUBLICATION",
      });
      const ready = await dispatch(rule);
      expect(ready).toHaveLength(1);
      await finish({ receiptId: ready[0].id });
      const content = (await entities.folios.getById(target.id)).content;
      expect(content).toContain(String(event.payload.fields.changelog));
      expect(content).not.toContain("CHANGED AFTER PUBLICATION");
      expect(content.match(/## 1.0.0/g)).toHaveLength(1);
      const jobs = await notifications();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({
        type: channel,
        category: "releases",
        lang: "en",
      });
      expect(
        (
          await persistence.runs.getOne({
            where: {
              automationId: rule.id,
              occurrenceId: ready[0].occurrenceId,
            },
          })
        ).snapshot.actions.map((action) => action.status),
      ).toEqual(["succeeded", "queued"]);
      await alepha
        .inject(ReleaseController)
        .reopenRelease.fetch({ params: { id: published.id } }, { user });
      await publish(published.id);
      await dispatch(rule);
      expect(
        (await entities.folios.getById(target.id)).content.match(/## 1.0.0/g),
      ).toHaveLength(2);
      expect(await notifications()).toHaveLength(2);
    });
  }
  it("resumes an interrupted append without duplicating it or losing a later human edit", async ({
    expect,
  }) => {
    const target = await folio();
    const rule = await arm("release-to-folio", { folio: target.id });
    const published = await release();
    await publish(published.id);
    const opened = await claimRelease(rule);
    faults.crashAfterAppend = true;
    await expect(
      alepha.inject(AutomationDomainActions).execute({
        occurrenceId: opened.occurrence.id,
        token: opened.occurrence.leaseToken!,
        index: 0,
        context: opened.context,
      }),
    ).rejects.toThrow("Interrupted after publication append committed");
    const appended = (await entities.folios.getById(target.id)).content;
    await alepha.inject(FolioController).update(
      {
        params: { id: target.id },
        body: { content: `${appended}\n\nLater human edit` },
      },
      { user },
    );
    await finish({
      receiptId: opened.occurrence.id,
      token: opened.occurrence.leaseToken!,
    });
    const content = (await entities.folios.getById(target.id)).content;
    expect(content.match(/## 1.0.0/g)).toHaveLength(1);
    expect(content).toContain("Later human edit");
    expect(await notifications()).toHaveLength(1);
  });
  it("preserves a concurrent human edit when the append CAS loses and retries", async ({
    expect,
  }) => {
    const target = await folio();
    const rule = await arm("release-to-folio", { folio: target.id });
    const published = await release();
    await publish(published.id);
    const opened = await claimRelease(rule);
    faults.beforeAppend = () =>
      isolate(async () => {
        await alepha.inject(FolioController).update(
          {
            params: { id: target.id },
            body: { content: "Concurrent human content" },
          },
          { user },
        );
      });
    const execute = () =>
      alepha.inject(AutomationDomainActions).execute({
        occurrenceId: opened.occurrence.id,
        token: opened.occurrence.leaseToken!,
        index: 0,
        context: opened.context,
      });
    await expect(execute()).rejects.toThrow("Atomic automation batch failed");
    expect((await entities.folios.getById(target.id)).content).toBe(
      "Concurrent human content",
    );
    await finish({
      receiptId: opened.occurrence.id,
      token: opened.occurrence.leaseToken!,
    });
    const content = (await entities.folios.getById(target.id)).content;
    expect(content).toContain("Concurrent human content");
    expect(content.match(/## 1.0.0/g)).toHaveLength(1);
    expect(await notifications()).toHaveLength(1);
  });
  it("retains the committed append and records a partial outcome when notify fails", async ({
    expect,
  }) => {
    const target = await folio();
    const rule = await arm("release-to-folio", { folio: target.id });
    const published = await release();
    await publish(published.id);
    alepha.inject(PublicationNotifications).refuse = true;
    const ready = await dispatch(rule);
    const run = await persistence.runs.getOne({
      where: { automationId: rule.id, occurrenceId: ready[0].occurrenceId },
    });
    expect(run).toMatchObject({
      status: "partial",
      snapshot: { actions: [{ status: "succeeded" }, { status: "failed" }] },
    });
    expect(
      (await entities.folios.getById(target.id)).content.match(/## 1.0.0/g),
    ).toHaveLength(1);
    expect(await notifications()).toHaveLength(0);
  });
});
