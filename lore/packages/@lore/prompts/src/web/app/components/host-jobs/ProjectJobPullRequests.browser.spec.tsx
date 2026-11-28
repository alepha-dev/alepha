import type { HostJobResource, PullRequestState } from "@lore/core/schemas";
import { I18n } from "@lore/core/web";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import ProjectJobPullRequests from "./ProjectJobPullRequests.tsx";

/**
 * Answers `getJob` with the job as given. Substitution, not `vi.mock`.
 */
class JobLinkProvider extends LinkProvider {
  public static job: HostJobResource;
  override client(): any {
    return new Proxy(
      {},
      {
        get: () =>
          Object.assign(async () => JobLinkProvider.job, { can: () => true }),
      },
    );
  }
}

const pr = (over: Partial<PullRequestState> = {}): PullRequestState => ({
  url: "https://github.com/acme/web/pull/118",
  number: 118,
  title: "Fix the login redirect",
  state: "open",
  checks: "failing",
  review: "approved",
  headRef: "lore/q5",
  baseRef: "main",
  outside: false,
  failingChecks: [
    { id: 1, name: "test", url: "https://github.com/acme/web/actions/runs/1" },
  ],
  mergeableState: "behind",
  ...over,
});

const job = (pullRequests: PullRequestState[]): HostJobResource =>
  ({
    id: "4b1f0c33-9d8a-4f5e-9a51-5c1d1e0f0a11",
    projectId: 1,
    hostId: "4b1f0c33-9d8a-4f5e-9a51-5c1d1e0f0a12",
    kind: "agent",
    status: "succeeded",
    input: { source: { mode: "write", branch: "lore/q5" } },
    queuedAt: "2026-11-28T10:00:00.000Z",
    pullRequests,
  }) as unknown as HostJobResource;

/**
 * The job page's pull request section (#Q4369): state, checks by name,
 * review, behind or in conflict, and a pull request shared by a quest's jobs.
 */
describe("ProjectJobPullRequests", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });
  let alepha: Alepha | undefined;
  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (resource: HostJobResource) => {
    JobLinkProvider.job = resource;
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: JobLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    render(
      <AlephaContext.Provider value={alepha}>
        <ProjectJobPullRequests job={resource} />
      </AlephaContext.Provider>,
    );
  };

  it("shows an open pull request with its failing checks by name, its review and that it is behind", async ({
    expect,
  }) => {
    await show(job([pr()]));
    const section = screen.getByTestId("job-pull-requests");
    expect(section.textContent).toContain("#118 Fix the login redirect");
    expect(section.textContent).toContain("lore/q5 → main");
    expect(screen.getByTestId("job-pull-request-state").textContent).toBe(
      "Open",
    );
    expect(section.textContent).toContain("Checks failing");
    expect(section.textContent).toContain("Approved");
    expect(section.textContent).toContain("Behind its base");
    const failing = screen.getByTestId("job-pull-request-failing");
    expect(failing.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/acme/web/actions/runs/1",
    );
    // A lore/q<n> branch is every write job's of the quest.
    expect(section.textContent).toContain("Shared by every job of the quest");
  });

  it("shows a merged one without its checks or conflict", async ({
    expect,
  }) => {
    await show(job([pr({ state: "merged", checks: "passing" })]));
    expect(screen.getByTestId("job-pull-request-state").textContent).toBe(
      "Merged",
    );
    expect(screen.queryByTestId("job-pull-request-failing")).toBeNull();
    expect(screen.getByTestId("job-pull-requests").textContent).not.toContain(
      "Behind its base",
    );
  });

  it("shows nothing for a job with no pull request", async ({ expect }) => {
    await show(job([]));
    expect(screen.queryByTestId("job-pull-requests")).toBeNull();
  });
});
