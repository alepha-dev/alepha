import { DialogProvider, Toaster } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { WorkflowsResource } from "../../../../../api/schemas/workflowsResourceSchema.ts";
import ProjectWorkflows from "./ProjectWorkflows.tsx";

const world: {
  answer: WorkflowsResource;
  dispatched: unknown[];
  reruns: unknown[];
} = {
  answer: { connected: false, workflows: [], runs: [] },
  dispatched: [],
  reruns: [],
};

class FakeLinks extends LinkProvider {
  override client(): any {
    const answers: Record<string, (input: any) => unknown> = {
      getWorkflows: () => world.answer,
      dispatchWorkflow: (input) => {
        world.dispatched.push(input.body);
        return { id: "00000000-0000-4000-8000-000000000001" };
      },
      rerunWorkflowRun: (input) => {
        world.reruns.push({ ...input.params, ...input.body });
        return { ok: true };
      },
    };
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(async (input: unknown) => answers[name]?.(input), {
            can: () => true,
          }),
      },
    );
  }
}

const connected: WorkflowsResource = {
  connected: true,
  repository: "acme/web",
  defaultBranch: "main",
  workflows: [
    {
      id: 11,
      name: "Release",
      path: ".github/workflows/release.yml",
      inputs: [
        {
          name: "bump",
          required: true,
          type: "choice",
          options: ["patch", "minor"],
        },
        { name: "note", required: false, type: "string", default: "hello" },
      ],
    },
  ],
  runs: [
    {
      id: 501,
      workflowId: 11,
      name: "Release",
      branch: "main",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/acme/web/actions/runs/501",
      createdAt: "2026-11-28T10:05:00Z",
      requestedBy: "Ada",
    },
  ],
};

/**
 * Ship > Workflows (#Q4366): the workflows with Run, a form from their
 * inputs, the recent runs with who started them from Lore, and the run
 * controls only for a rank holding `deploy:workflow`.
 */
describe("ProjectWorkflows", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
    world.dispatched = [];
    world.reruns = [];
  });

  const show = async (permissions: string[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      ...projectFixture(),
      slug: "acme",
      permissions,
    } as never);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster />
          <ProjectWorkflows />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByTestId("project-workflows");
  };

  it("says a project not connected is not, with the way to connect it", async ({
    expect,
  }) => {
    world.answer = { connected: false, workflows: [], runs: [] };
    await show(["app:read", "deploy:workflow"]);
    await screen.findByText(
      "This project is not connected to a GitHub repository.",
    );
    expect(screen.queryByTestId("workflows-list")).toBeNull();
  });

  it("runs a workflow from a form of its inputs, and re-runs a failed run's jobs", async ({
    expect,
  }) => {
    world.answer = connected;
    await show(["app:read", "deploy:workflow"]);
    const run = await screen.findByTestId("workflow-run-row-501");
    expect(run.textContent).toContain("by Ada from Lore");
    expect(run.textContent).toContain("Failed");

    fireEvent.click(screen.getByTestId("workflow-run-11"));
    const dialog = await screen.findByTestId("workflow-run-dialog");
    expect(dialog.textContent).toContain("Run Release");
    expect(screen.getByTestId("workflow-input-bump")).toBeTruthy();
    const note = screen
      .getByTestId("workflow-input-note")
      .querySelector("input, textarea") as HTMLInputElement;
    expect(note.value).toBe("hello");
    const ref = screen
      .getByTestId("workflow-run-ref")
      .querySelector("input, textarea") as HTMLInputElement;
    expect(ref.value).toBe("main");

    fireEvent.click(screen.getByText("Re-run failed jobs"));
    await waitFor(() =>
      expect(world.reruns).toEqual([
        { projectId: 1, runId: 501, failedOnly: true },
      ]),
    );
  });

  it("shows no run control to a rank without deploy:workflow", async ({
    expect,
  }) => {
    world.answer = connected;
    await show(["app:read"]);
    await screen.findByTestId("workflow-run-row-501");
    expect(screen.queryByTestId("workflow-run-11")).toBeNull();
    expect(screen.queryByText("Re-run failed jobs")).toBeNull();
  });
});
