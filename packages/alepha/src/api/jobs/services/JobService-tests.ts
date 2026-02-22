import { $inject, type Alepha, t } from "alepha";
import { $repository } from "alepha/orm";
import { expect } from "vitest";
import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";
import { $job } from "../primitives/$job.ts";
import { JobService } from "./JobService.ts";

// =============================================================================
// testGetStatsEmpty
// =============================================================================

export const testGetStatsEmpty = async (alepha: Alepha) => {
  class App {
    jobService = $inject(JobService);
    myJob = $job({
      schema: t.object({ value: t.text() }),
      handler: async () => {},
    });
  }

  const app = alepha.inject(App);
  await alepha.start();

  const stats = await app.jobService.getStats();

  expect(stats.registered).toBe(1);
  expect(stats.running).toBe(0);
  expect(stats.pending).toBe(0);
  expect(stats.scheduled).toBe(0);
  expect(stats.retrying).toBe(0);
  expect(stats.dead).toBe(0);
  expect(stats.completed24h).toBe(0);
  expect(stats.failed24h).toBe(0);
};

// =============================================================================
// testGetStatsWithMixedStatuses
// =============================================================================

export const testGetStatsWithMixedStatuses = async (alepha: Alepha) => {
  class App {
    repo = $repository(jobExecutionEntity);
    jobService = $inject(JobService);
    jobA = $job({
      schema: t.object({ value: t.text() }),
      handler: async () => {},
    });
    jobB = $job({
      cron: "0 0 * * *",
      handler: async () => {},
    });
  }

  const app = alepha.inject(App);
  await alepha.start();

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000).toISOString();

  // Create executions with different statuses
  await app.repo.create({
    jobName: "App.jobA",
    status: "running",
    priority: 2,
    maxAttempts: 1,
    attempt: 1,
    startedAt: oneHourAgo,
  });

  await app.repo.create({
    jobName: "App.jobA",
    status: "pending",
    priority: 2,
    maxAttempts: 1,
  });

  await app.repo.create({
    jobName: "App.jobA",
    status: "scheduled",
    priority: 2,
    maxAttempts: 1,
    scheduledAt: oneHourAgo,
  });

  await app.repo.create({
    jobName: "App.jobA",
    status: "retrying",
    priority: 2,
    maxAttempts: 3,
    attempt: 1,
    scheduledAt: oneHourAgo,
  });

  await app.repo.create({
    jobName: "App.jobA",
    status: "dead",
    priority: 2,
    maxAttempts: 1,
    attempt: 1,
    error: "boom",
    completedAt: oneHourAgo,
  });

  // completed within 24h
  await app.repo.create({
    jobName: "App.jobA",
    status: "completed",
    priority: 2,
    maxAttempts: 1,
    attempt: 1,
    completedAt: oneHourAgo,
  });

  // completed outside 24h — should NOT count
  await app.repo.create({
    jobName: "App.jobA",
    status: "completed",
    priority: 2,
    maxAttempts: 1,
    attempt: 1,
    completedAt: twoDaysAgo,
  });

  // dead within 24h — should count for failed24h
  await app.repo.create({
    jobName: "App.jobA",
    status: "dead",
    priority: 2,
    maxAttempts: 1,
    attempt: 1,
    error: "recent failure",
    completedAt: oneHourAgo,
  });

  // dead outside 24h — should NOT count for failed24h
  await app.repo.create({
    jobName: "App.jobA",
    status: "dead",
    priority: 2,
    maxAttempts: 1,
    attempt: 1,
    error: "old failure",
    completedAt: twoDaysAgo,
  });

  const stats = await app.jobService.getStats();

  expect(stats.registered).toBe(2); // jobA + jobB
  expect(stats.running).toBe(1);
  expect(stats.pending).toBe(1);
  expect(stats.scheduled).toBe(1);
  expect(stats.retrying).toBe(1);
  expect(stats.dead).toBe(3); // all dead regardless of time
  expect(stats.completed24h).toBe(1); // only the recent one
  expect(stats.failed24h).toBe(2); // 2 dead within 24h (the recent dead ones)
};
