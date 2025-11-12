import { Alepha } from "@alepha/core";
import { DateTimeProvider, dayjs } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { describe, expect, it } from "vitest";
import { JobController } from "../src/controllers/JobController.ts";
import { $job } from "../src/descriptors/$job.ts";
import { JobService } from "../src/services/JobService.ts";

describe("JobController", () => {
  class App {
    testJob = $job({
      name: "test-job",
      handler: async () => {
        // Test job that is manually triggered
      },
    });

    dailyJob = $job({
      name: "daily-job",
      handler: async () => {
        // Another test job
      },
    });
  }

  const setup = async () => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const ctrl = alepha.inject(JobController);
    const service = alepha.inject(JobService);
    const dtp = alepha.inject(DateTimeProvider);
    await alepha.start();
    return { alepha, app, ctrl, service, dtp };
  };

  describe("getJobs", () => {
    it("should return all job names", async () => {
      const { ctrl } = await setup();
      const jobs = await ctrl.getJobs();
      expect(jobs).toContain("test-job");
      expect(jobs).toContain("daily-job");
      expect(jobs.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty array when no jobs exist", async () => {
      const alepha = Alepha.create();
      const ctrl = alepha.inject(JobController);
      await alepha.start();
      const jobs = await ctrl.getJobs();
      expect(jobs).toEqual([]);
    });
  });

  describe("getJobExecutions", () => {
    it("should return job executions for a specific job", async () => {
      const { app, ctrl } = await setup();

      // Trigger a job to create execution records
      await app.testJob.trigger();

      const executions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });

      expect(executions.content.length).toBeGreaterThan(0);
      expect(executions.content[0].job).toBe("test-job");
    });

    it("should populate finishedAt when job completes", async () => {
      const { app, ctrl } = await setup();

      await app.testJob.trigger();

      const executions = await ctrl.getJobExecutions({
        query: { job: "test-job", status: "COMPLETED" },
      });

      expect(executions.content.length).toBeGreaterThan(0);
      const execution = executions.content[0];
      expect(execution.status).toBe("COMPLETED");
      expect(execution.finishedAt).toBeDefined();
      expect(new Date(execution.finishedAt!).valueOf()).toBeGreaterThan(0);
    });

    it("should capture logs during job execution", async () => {
      class TestAppWithLogs {
        log = $logger();

        loggingJob = $job({
          name: "logging-job",
          handler: async () => {
            this.log.info("Starting job execution");
            this.log.info("Processing data");
            this.log.info("Job completed successfully");
          },
        });
      }

      const alepha = Alepha.create();
      const testApp = alepha.inject(TestAppWithLogs);
      const ctrl = alepha.inject(JobController);
      await alepha.start();

      await testApp.loggingJob.trigger();

      const executions = await ctrl.getJobExecutions({
        query: { job: "logging-job" },
      });

      expect(executions.content.length).toBeGreaterThan(0);
      const execution = executions.content[0];
      expect(execution.logs).toBeDefined();
      expect(Array.isArray(execution.logs)).toBe(true);
      const logInfos = execution.logs?.filter((log) => log.level === "INFO");
      expect(logInfos?.length).toBeGreaterThanOrEqual(3);
      expect(logInfos?.[0].message).toBe("Starting job execution");
      expect(logInfos?.[1].message).toBe("Processing data");
      expect(logInfos?.[2].message).toBe("Job completed successfully");
    });

    it("should capture error and finishedAt when job fails", async () => {
      // Create a separate Alepha instance with a failing job
      class FailingApp {
        failingJob = $job({
          name: "failing-job",
          handler: async () => {
            throw new Error("Intentional test failure");
          },
        });
      }

      const alepha = Alepha.create();
      const failingApp = alepha.inject(FailingApp);
      const ctrl = alepha.inject(JobController);
      await alepha.start();

      // Trigger the job (it will fail silently)
      await failingApp.failingJob.trigger().catch(() => {
        // Expected to fail
      });

      const executions = await ctrl.getJobExecutions({
        query: { job: "failing-job", status: "FAILED" },
      });

      expect(executions.content.length).toBeGreaterThan(0);
      const execution = executions.content[0];
      expect(execution.status).toBe("FAILED");
      expect(execution.error).toBe("Intentional test failure");
      expect(execution.finishedAt).toBeDefined();
      expect(new Date(execution.finishedAt!).valueOf()).toBeGreaterThan(0);
    });

    it("should return empty list when job has no executions", async () => {
      const { ctrl } = await setup();

      const executions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });

      expect(executions.content).toEqual([]);
      expect(executions.page.totalElements).toBe(0);
    });

    it("should filter executions by status", async () => {
      const { app, ctrl } = await setup();

      // Trigger job to create STARTED and COMPLETED execution
      await app.testJob.trigger();

      const allExecutions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });
      expect(allExecutions.content.length).toBeGreaterThan(0);

      const completedExecutions = await ctrl.getJobExecutions({
        query: { job: "test-job", status: "COMPLETED" },
      });
      expect(
        completedExecutions.content.every((e) => e.status === "COMPLETED"),
      ).toBe(true);
    });

    it("should support pagination", async () => {
      const { app, ctrl } = await setup();

      // Trigger job multiple times
      await app.testJob.trigger();
      await app.testJob.trigger();
      await app.testJob.trigger();

      const page1 = await ctrl.getJobExecutions({
        query: { job: "test-job", size: 2, page: 0 },
      });

      expect(page1.content.length).toBeLessThanOrEqual(2);
      expect(page1.page.totalElements).toBeGreaterThanOrEqual(3);

      if (page1.page.totalElements && page1.page.totalElements > 2) {
        const page2 = await ctrl.getJobExecutions({
          query: { job: "test-job", size: 2, page: 1 },
        });
        expect(page2.content.length).toBeGreaterThan(0);
      }
    });

    it("should return executions sorted by creation date descending by default", async () => {
      const { app, ctrl } = await setup();

      // Trigger job multiple times
      await app.testJob.trigger();
      await app.testJob.trigger();

      const executions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });

      expect(executions.content.length).toBeGreaterThanOrEqual(2);

      // Verify descending order
      for (let i = 1; i < executions.content.length; i++) {
        const prev = dayjs(executions.content[i - 1].createdAt);
        const curr = dayjs(executions.content[i].createdAt);
        expect(prev.valueOf()).toBeGreaterThanOrEqual(curr.valueOf());
      }
    });
  });

  describe("triggerJob", () => {
    it("should trigger a job by name", async () => {
      const { ctrl } = await setup();

      const result = await ctrl.triggerJob({
        body: { name: "test-job" },
      });

      expect(result.ok).toBe(true);
    });

    it("should throw error for non-existent job", async () => {
      const { ctrl } = await setup();

      await expect(
        ctrl.triggerJob({
          body: { name: "non-existent-job" },
        }),
      ).rejects.toThrow("Job not found: non-existent-job");
    });

    it("should create execution record when job is triggered", async () => {
      const { ctrl } = await setup();

      // Get initial execution count
      const initialExecutions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });
      const initialCount = initialExecutions.page.totalElements ?? 0;

      // Trigger job
      await ctrl.triggerJob({
        body: { name: "test-job" },
      });

      // Verify execution record was created
      const finalExecutions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });
      expect(finalExecutions.page.totalElements ?? 0).toBe(initialCount + 1);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete job lifecycle", async () => {
      const { ctrl } = await setup();

      // Get all jobs
      const jobs = await ctrl.getJobs();
      expect(jobs).toContain("test-job");

      // Trigger job
      const triggerResult = await ctrl.triggerJob({
        body: { name: "test-job" },
      });
      expect(triggerResult.ok).toBe(true);

      // Get executions
      const executions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });
      expect(executions.content.length).toBeGreaterThan(0);
      const execution = executions.content[0];
      expect(execution.job).toBe("test-job");
      expect(execution.status).toBe("COMPLETED");
      expect(execution.finishedAt).toBeDefined();
      expect(execution.createdAt).toBeDefined();
      expect(execution.updatedAt).toBeDefined();
    });

    it("should handle multiple jobs with different execution statuses", async () => {
      const { app, ctrl } = await setup();

      // Trigger both jobs
      await app.testJob.trigger();
      await app.dailyJob.trigger();

      // Get all executions for test-job
      const testJobExecutions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });
      expect(testJobExecutions.content.length).toBeGreaterThan(0);
      expect(testJobExecutions.content.every((e) => e.job === "test-job")).toBe(
        true,
      );

      // Get all executions for daily-job
      const dailyJobExecutions = await ctrl.getJobExecutions({
        query: { job: "daily-job" },
      });
      expect(dailyJobExecutions.content.length).toBeGreaterThan(0);
      expect(
        dailyJobExecutions.content.every((e) => e.job === "daily-job"),
      ).toBe(true);
    });

    it("should track job execution history over multiple triggers", async () => {
      const { app, ctrl } = await setup();

      // Trigger job multiple times
      await app.testJob.trigger();
      await app.testJob.trigger();
      await app.testJob.trigger();

      const executions = await ctrl.getJobExecutions({
        query: { job: "test-job" },
      });

      expect(executions.page.totalElements).toBeGreaterThanOrEqual(3);

      // Verify all executions are for the same job
      expect(executions.content.every((e) => e.job === "test-job")).toBe(true);
    });
  });
});
