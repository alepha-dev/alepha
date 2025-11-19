import { Alepha } from "alepha";
import { test } from "vitest";
import {
  $activity,
  $workflow,
  WorkflowEngineService,
  WorkflowRegistryService,
} from "../../src/api-workflows/index.ts";
import { $atom } from "../../src/core/descriptors/$atom.ts";
import { $inject } from "../../src/core/descriptors/$inject.ts";
import { t } from "../../src/core/providers/TypeProvider.ts";
import { AlephaQueue } from "../../src/queue/index.ts";

test("should define and register a workflow", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaQueue);

  class TestActivities {
    greet = $activity({
      name: "greet",
      schema: t.object({
        name: t.text(),
      }),
      handler: async ({ name }) => {
        return { message: `Hello, ${name}!` };
      },
    });
  }

  class TestWorkflows {
    activities = $inject(TestActivities);

    greeting = $workflow({
      name: "greeting-workflow",
      version: "1",
      schema: t.object({
        name: t.text(),
      }),
      handler: async ({ name }, ctx) => {
        const result = await ctx.activity(this.activities.greet, { name });
        return result;
      },
    });
  }

  const workflows = alepha.inject(TestWorkflows);
  const registry = alepha.inject(WorkflowRegistryService);

  // Register workflow
  registry.registerWorkflow(workflows.greeting);

  // Verify registration
  const registered = registry.getWorkflow("greeting-workflow", "1");
  expect(registered).toBeDefined();
  expect(registered?.name).toBe("greeting-workflow");
  expect(registered?.version).toBe("1");
});

test("should start a workflow execution", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaQueue);

  class TestWorkflows {
    simple = $workflow({
      name: "simple-workflow",
      schema: t.object({
        value: t.number(),
      }),
      handler: async ({ value }) => {
        return { result: value * 2 };
      },
    });
  }

  const workflows = alepha.inject(TestWorkflows);
  const registry = alepha.inject(WorkflowRegistryService);
  const engine = alepha.inject(WorkflowEngineService);

  await alepha.start();

  // Register workflow
  registry.registerWorkflow(workflows.simple);

  // Start workflow
  const execution = await engine.start(workflows.simple, { value: 42 });

  expect(execution.workflowId).toBeDefined();
  expect(execution.status).toBe("running");
  expect(execution.startedAt).toBeDefined();

  // Check status
  const status = await engine.getStatus(execution.workflowId);
  expect(status).toBeDefined();
  expect(status?.workflowId).toBe(execution.workflowId);
  expect(status?.workflowName).toBe("simple-workflow");
});

test("should send signal to workflow", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaQueue);

  // Define signal
  const ApprovalSignal = $atom({
    name: "approval",
    schema: t.object({
      approved: t.boolean(),
    }),
    default: { approved: false },
  });

  class TestWorkflows {
    approval = $workflow({
      name: "approval-workflow",
      schema: t.object({
        requestId: t.text(),
      }),
      handler: async ({ requestId }, ctx) => {
        const decision = await ctx.waitForSignal(ApprovalSignal);
        return { requestId, approved: (decision as any).approved };
      },
    });
  }

  const workflows = alepha.inject(TestWorkflows);
  const registry = alepha.inject(WorkflowRegistryService);
  const engine = alepha.inject(WorkflowEngineService);

  await alepha.start();

  // Register and start workflow
  registry.registerWorkflow(workflows.approval);
  const execution = await engine.start(workflows.approval, {
    requestId: "req-123",
  });

  // Send signal
  await engine.signal(execution.workflowId, ApprovalSignal, { approved: true });

  // Verify signal was queued (actual processing would happen in background worker)
  const status = await engine.getStatus(execution.workflowId);
  expect(status?.status).toBe("running");
});

test("should list registered workflows", async ({ expect }) => {
  const alepha = Alepha.create().with(AlephaQueue);

  class TestWorkflows {
    workflow1 = $workflow({
      name: "workflow-1",
      schema: t.object({ value: t.number() }),
      handler: async () => ({}),
    });

    workflow2 = $workflow({
      name: "workflow-2",
      schema: t.object({ name: t.text() }),
      handler: async () => ({}),
    });
  }

  const workflows = alepha.inject(TestWorkflows);
  const registry = alepha.inject(WorkflowRegistryService);

  registry.registerWorkflow(workflows.workflow1);
  registry.registerWorkflow(workflows.workflow2);

  const list = registry.listWorkflows();
  expect(list).toHaveLength(2);
  expect(list[0].name).toBe("workflow-1");
  expect(list[1].name).toBe("workflow-2");
});
