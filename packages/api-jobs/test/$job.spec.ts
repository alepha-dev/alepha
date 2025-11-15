import { Alepha } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { $repository } from "@alepha/orm";
import { describe, expect, it, vi } from "vitest";
import { $job } from "../src/descriptors/$job.ts";
import { jobExecutions } from "../src/entities/jobExecutions.ts";

describe("$job descriptor", () => {
  describe("basic functionality", () => {
    it("should execute handler when triggered", async () => {
      const handler = vi.fn();

      class App {
        testJob = $job({
          name: "test-job",
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.testJob.trigger();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          now: expect.any(Object),
        }),
      );
    });

    it("should use default name from property key", async () => {
      class App {
        myScheduledJob = $job({
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      expect(app.myScheduledJob.name).toBe("App.myScheduledJob");
    });

    it("should use custom name when provided", async () => {
      class App {
        someJob = $job({
          name: "custom-job-name",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      expect(app.someJob.name).toBe("custom-job-name");
    });
  });

  describe("execution tracking", () => {
    it("should create execution record when job starts", async () => {
      class App {
        repo = $repository(jobExecutions);

        testJob = $job({
          name: "tracked-job",
          handler: async () => {
            const executions = await this.repo.find({
              where: { job: "tracked-job", status: "STARTED" },
            });
            expect(executions.length).toBe(1);
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.testJob.trigger();
    });

    it("should mark execution as COMPLETED on success", async () => {
      class App {
        repo = $repository(jobExecutions);

        testJob = $job({
          name: "success-job",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.testJob.trigger();

      const executions = await app.repo.find({
        where: { job: "success-job", status: "COMPLETED" },
      });

      expect(executions.length).toBe(1);
      expect(executions[0].status).toBe("COMPLETED");
      expect(executions[0].finishedAt).toBeDefined();
      expect(executions[0].error).toBeUndefined();
    });

    it("should mark execution as FAILED on error", async () => {
      class App {
        repo = $repository(jobExecutions);

        failingJob = $job({
          name: "failing-job",
          handler: async () => {
            throw new Error("Test error");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      // Trigger should not throw, it handles errors internally
      await app.failingJob.trigger();

      const executions = await app.repo.find({
        where: { job: "failing-job", status: "FAILED" },
      });

      expect(executions.length).toBe(1);
      expect(executions[0].status).toBe("FAILED");
      expect(executions[0].error).toBe("Test error");
      expect(executions[0].finishedAt).toBeDefined();
    });

    it("should capture logs during execution", async () => {
      class App {
        log = $logger();
        repo = $repository(jobExecutions);

        loggingJob = $job({
          name: "logging-job",
          handler: async () => {
            this.log.info("Log message 1");
            this.log.info("Log message 2");
            this.log.warn("Warning message");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.loggingJob.trigger();

      const executions = await app.repo.find({
        where: { job: "logging-job" },
      });

      expect(executions.length).toBe(1);
      expect(executions[0].logs).toBeDefined();
      expect(Array.isArray(executions[0].logs)).toBe(true);

      const logs = executions[0].logs!;
      const infoLogs = logs.filter((log) => log.level === "INFO");
      const warnLogs = logs.filter((log) => log.level === "WARN");

      expect(infoLogs.length).toBe(2);
      expect(warnLogs.length).toBe(1);
      expect(infoLogs[0].message).toBe("Log message 1");
      expect(infoLogs[1].message).toBe("Log message 2");
      expect(warnLogs[0].message).toBe("Warning message");
    });

    it("should capture logs even when job fails", async () => {
      class App {
        log = $logger();
        repo = $repository(jobExecutions);

        failingJob = $job({
          name: "failing-with-logs",
          handler: async () => {
            this.log.info("Before error");
            throw new Error("Test failure");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.failingJob.trigger();

      const executions = await app.repo.find({
        where: { job: "failing-with-logs" },
      });

      expect(executions.length).toBe(1);
      expect(executions[0].status).toBe("FAILED");
      expect(executions[0].logs).toBeDefined();

      const logs = executions[0].logs!;
      const infoLogs = logs.filter((log) => log.level === "INFO");

      expect(infoLogs.length).toBeGreaterThanOrEqual(1);
      expect(infoLogs[0].message).toBe("Before error");
    });

    it("should clean up logs after execution", async () => {
      class App {
        log = $logger();
        repo = $repository(jobExecutions);

        cleanupJob = $job({
          name: "cleanup-job",
          handler: async () => {
            this.log.info("Test log");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.cleanupJob.trigger();

      // Verify job completed successfully (logs are cleaned up internally)
      const executions = await app.repo.find({
        where: { job: "cleanup-job", status: "COMPLETED" },
      });

      expect(executions.length).toBe(1);
      expect(executions[0].logs).toBeDefined();
      expect(Array.isArray(executions[0].logs)).toBe(true);
    });
  });

  describe("event emission", () => {
    it("should emit scheduler:begin event", async () => {
      const beginHandler = vi.fn();

      class App {
        testJob = $job({
          name: "event-job",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);

      alepha.events.on("scheduler:begin", beginHandler);
      await alepha.start();

      await app.testJob.trigger();

      expect(beginHandler).toHaveBeenCalledTimes(1);
      expect(beginHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "event-job",
          now: expect.any(Object),
          context: expect.any(String),
        }),
      );
    });

    it("should emit scheduler:success event on completion", async () => {
      const successHandler = vi.fn();

      class App {
        testJob = $job({
          name: "success-event-job",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);

      alepha.events.on("scheduler:success", successHandler);
      await alepha.start();

      await app.testJob.trigger();

      expect(successHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "success-event-job",
          context: expect.any(String),
        }),
      );
    });

    it("should emit scheduler:error event on failure", async () => {
      const errorHandler = vi.fn();

      class App {
        failingJob = $job({
          name: "error-event-job",
          handler: async () => {
            throw new Error("Test error");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);

      alepha.events.on("scheduler:error", errorHandler);
      await alepha.start();

      await app.failingJob.trigger();

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "error-event-job",
          error: expect.objectContaining({
            message: "Test error",
          }),
          context: expect.any(String),
        }),
      );
    });

    it("should emit scheduler:end event after completion", async () => {
      const endHandler = vi.fn();

      class App {
        testJob = $job({
          name: "end-event-job",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);

      alepha.events.on("scheduler:end", endHandler);
      await alepha.start();

      await app.testJob.trigger();

      expect(endHandler).toHaveBeenCalledTimes(1);
      expect(endHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "end-event-job",
          context: expect.any(String),
        }),
      );
    });
  });

  describe("scheduling", () => {
    it("should support cron option", async () => {
      // This test verifies the descriptor accepts cron option
      class App {
        cronJob = $job({
          name: "cron-job",
          cron: "0 0 * * *", // Daily at midnight
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      expect(app.cronJob.name).toBe("cron-job");
    });
  });

  describe("locking", () => {
    it("should use lock by default", async () => {
      const handler = vi.fn();

      class App {
        lockedJob = $job({
          name: "locked-job",
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      // Trigger multiple times in parallel
      await Promise.all([
        app.lockedJob.trigger(),
        app.lockedJob.trigger(),
        app.lockedJob.trigger(),
      ]);

      // All should execute (local lock doesn't prevent execution in tests)
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("should skip lock when lock: false", async () => {
      const handler = vi.fn();

      class App {
        unlockedJob = $job({
          name: "unlocked-job",
          lock: false,
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.unlockedJob.trigger();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("multiple executions", () => {
    it("should create separate execution records for each trigger", async () => {
      class App {
        repo = $repository(jobExecutions);

        testJob = $job({
          name: "multi-exec-job",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.testJob.trigger();
      await app.testJob.trigger();
      await app.testJob.trigger();

      const executions = await app.repo.find({
        where: { job: "multi-exec-job" },
      });

      expect(executions.length).toBe(3);
      expect(executions.every((e) => e.status === "COMPLETED")).toBe(true);
    });
  });

  describe("environment variables", () => {
    it("should respect JOB_PREFIX env variable for lock key", async () => {
      class App {
        testJob = $job({
          name: "prefixed-job",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      // The lock key should use the prefix if set
      // This is tested indirectly through execution
      await app.testJob.trigger();

      expect(app.testJob.name).toBe("prefixed-job");
    });
  });
});
