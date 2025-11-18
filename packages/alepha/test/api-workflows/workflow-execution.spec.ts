import { Alepha } from "alepha";
import { test } from "vitest";
import {
  $workflow,
  $activity,
  AlephaApiWorkflows,
  WorkflowEngineService,
  WorkflowRegistryService,
  WorkflowExecutionService,
} from "../../src/api-workflows/index.ts";
import { AlephaQueue } from "../../src/queue/index.ts";
import { t } from "../../src/core/providers/TypeProvider.ts";
import { $inject } from "../../src/core/descriptors/$inject.ts";
import { $atom } from "../../src/core/descriptors/$atom.ts";

test("should execute workflow with activities", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaQueue);

  class TestActivities {
    processOrder = $activity({
      name: "process-order",
      schema: t.object({
        orderId: t.text(),
        amount: t.number(),
      }),
      handler: async ({ orderId, amount }) => {
        return {
          orderId,
          amount,
          processed: true,
        };
      },
    });
  }

  class TestWorkflows {
    activities = $inject(TestActivities);

    orderWorkflow = $workflow({
      name: "order-workflow",
      version: "1",
      schema: t.object({
        orderId: t.text(),
        amount: t.number(),
      }),
      handler: async ({ orderId, amount }, ctx) => {
        const processResult = (await ctx.activity(this.activities.processOrder, {
          orderId,
          amount,
        })) as { orderId: string; amount: number; processed: boolean };

        return {
          orderId,
          processed: processResult.processed,
        };
      },
    });
  }

  const workflows = alepha.inject(TestWorkflows);
  const activities = alepha.inject(TestActivities);
  const registry = alepha.inject(WorkflowRegistryService);
  const engine = alepha.inject(WorkflowEngineService);

  await alepha.start();

  // Register activities and workflows
  registry.registerActivity(activities.processOrder);
  registry.registerWorkflow(workflows.orderWorkflow);

  // Start workflow
  const execution = await engine.start(workflows.orderWorkflow, {
    orderId: "ORDER-123",
    amount: 99.99,
  });

  expect(execution.workflowId).toBeDefined();
  expect(execution.status).toBe("running");
  expect(execution.startedAt).toBeDefined();

  // Verify we can get workflow status
  const status = await engine.getStatus(execution.workflowId);
  expect(status).toBeDefined();
  expect(status?.workflowId).toBe(execution.workflowId);
  expect(status?.workflowName).toBe("order-workflow");
});

test("should handle workflow with signals", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaQueue);

  // Define signal
  const ApprovalSignal = $atom({
    name: "approval",
    schema: t.object({
      approved: t.boolean(),
      approver: t.text(),
    }),
    default: { approved: false, approver: "" },
  });

  class TestWorkflows {
    approvalWorkflow = $workflow({
      name: "approval-workflow",
      version: "1",
      schema: t.object({
        requestId: t.text(),
      }),
      handler: async ({ requestId }, ctx) => {
        // Wait for approval signal
        const decision = (await ctx.waitForSignal(ApprovalSignal)) as {
          approved: boolean;
          approver: string;
        };

        return {
          requestId,
          approved: decision.approved,
          approver: decision.approver,
        };
      },
    });
  }

  const workflows = alepha.inject(TestWorkflows);
  const registry = alepha.inject(WorkflowRegistryService);
  const engine = alepha.inject(WorkflowEngineService);

  await alepha.start();

  // Register workflow
  registry.registerWorkflow(workflows.approvalWorkflow);

  // Start workflow
  const execution = await engine.start(workflows.approvalWorkflow, {
    requestId: "REQ-456",
  });

  expect(execution.workflowId).toBeDefined();
  expect(execution.status).toBe("running");

  // Send approval signal
  await engine.signal(execution.workflowId, ApprovalSignal, {
    approved: true,
    approver: "manager@example.com",
  });

  // Verify signal was sent (status should still be running as workflow processes in background)
  const status = await engine.getStatus(execution.workflowId);
  expect(status).toBeDefined();
  expect(status?.workflowId).toBe(execution.workflowId);
});

test("should provide deterministic workflow context", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaQueue);

  class TestWorkflows {
    deterministicWorkflow = $workflow({
      name: "deterministic-workflow",
      version: "1",
      schema: t.object({
        seed: t.text(),
      }),
      handler: async ({ seed }, ctx) => {
        // Workflow context provides deterministic functions
        const random = ctx.random();
        const uuid = ctx.uuid();
        const time = ctx.now();

        return {
          random,
          uuid,
          time: time.toISOString(),
        };
      },
    });
  }

  const workflows = alepha.inject(TestWorkflows);
  const registry = alepha.inject(WorkflowRegistryService);
  const engine = alepha.inject(WorkflowEngineService);

  await alepha.start();

  // Register workflow
  registry.registerWorkflow(workflows.deterministicWorkflow);

  // Start workflow
  const execution = await engine.start(workflows.deterministicWorkflow, {
    seed: "test-seed",
  });

  expect(execution.workflowId).toBeDefined();
  expect(execution.status).toBe("running");

  // Verify workflow context is available
  const status = await engine.getStatus(execution.workflowId);
  expect(status).toBeDefined();
  expect(status?.input).toMatchObject({ seed: "test-seed" });
});
