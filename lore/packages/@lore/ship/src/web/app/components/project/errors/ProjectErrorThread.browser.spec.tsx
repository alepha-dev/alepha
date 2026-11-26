import { DialogProvider, Toaster } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import {
  currentProjectAtom,
  ElementReferenceRegistry,
  I18n,
} from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect as check, it } from "vitest";

import type { ProjectErrorDetail } from "../../../../../api/schemas/projectErrorDetailSchema.ts";
import type { ProjectErrorThreadEntry } from "../../../../../api/schemas/projectErrorThreadEntrySchema.ts";
import type { ProjectErrorThreadJob } from "../../../../../api/schemas/projectErrorThreadJobSchema.ts";
import ProjectErrorThread from "./ProjectErrorThread.tsx";

class RecordingLinkProvider extends LinkProvider {
  public calls: string[] = [];
  public args: Array<{ name: string; args: unknown[] }> = [];
  public responses: Record<string, unknown> = {};
  public denied = new Set<string>();

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          const call = async (...args: unknown[]) => {
            this.calls.push(prop);
            this.args.push({ name: prop, args });
            return this.responses[prop] ?? {};
          };
          return Object.assign(call, { can: () => !this.denied.has(prop) });
        },
      },
    );
  }
}

class Routes {
  projectQuest = $page({
    name: "projectQuest",
    path: "/:projectSlug/quests/:shortId",
    component: () => null,
  });
}

const ADA = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";

const detail = (
  error: Partial<ProjectErrorDetail["error"]> = {},
): ProjectErrorDetail => ({
  kind: "sigil",
  apps: [],
  rules: [],
  error: {
    id: 42,
    fingerprint: "abcdef",
    name: "TypeError",
    message: "cart is undefined",
    stack: "",
    sourceUrl: "",
    origin: "client",
    firstSeenAt: "2026-11-01T10:00:00.000Z",
    lastSeenAt: "2026-11-20T10:00:00.000Z",
    count: 7,
    status: "open",
    ...error,
  } as ProjectErrorDetail["error"],
});

/**
 * A thread as the API answers it: a member's verbs, one of Lore's own, a
 * member's comment and an agent's.
 */
const entries: ProjectErrorThreadEntry[] = [
  {
    type: "event",
    id: 1,
    at: "2026-11-02T10:00:00.000Z",
    kind: "trusted",
    userId: ADA,
    userName: "Ada",
  },
  {
    type: "comment",
    id: 10,
    at: "2026-11-03T10:00:00.000Z",
    userId: BOB,
    userName: "Bob",
    body: "Is this the **deploy** of Monday?",
  },
  {
    type: "comment",
    id: 11,
    at: "2026-11-04T10:00:00.000Z",
    userId: ADA,
    userName: "Ada",
    body: "Likely the cart reducer.",
    source: { kind: "mcp", client: "claude-code" },
  },
  {
    type: "event",
    id: 2,
    at: "2026-11-05T10:00:00.000Z",
    kind: "forwarded",
    userId: ADA,
    userName: "Ada",
    quest: { id: 900, shortId: 12, title: "Fix the cart" },
  },
  {
    type: "event",
    id: 3,
    at: "2026-11-06T10:00:00.000Z",
    kind: "handed_back",
    quest: { id: 900 },
  },
  {
    type: "event",
    id: 4,
    at: "2026-11-07T10:00:00.000Z",
    kind: "run_resolved",
  },
];

/**
 * The activity and discussion of an error's page (#E185): one timeline of
 * triage events and comments, a composer, and the notice an untrusted error
 * shows.
 */
describe("ProjectErrorThread", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (
    subject: ProjectErrorDetail,
    options: {
      entries?: ProjectErrorThreadEntry[];
      denied?: string[];
      viewer?: string;
      onTrust?: () => void;
      jobs?: ProjectErrorThreadJob[];
      onForwardFinding?: (commentId: number) => void;
      jobHref?: (jobId: string) => string;
    } = {},
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(Routes);
    alepha.inject(I18n);
    alepha.inject(ElementReferenceRegistry);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture({ slug: "acme" }));
    alepha.store.set(currentUserAtom, {
      id: options.viewer ?? BOB,
      roles: ["user"],
    } as never);
    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = {
      listProjectErrorThread: {
        entries: options.entries ?? entries,
        jobs: options.jobs ?? [],
      },
      getProjectUsers: [],
      deleteProjectErrorComment: { ok: true },
    };
    for (const name of options.denied ?? []) links.denied.add(name);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ProjectErrorThread
            detail={subject}
            projectId={1}
            projectSlug="acme"
            questHref={(shortId) => `/acme/quests/${shortId}`}
            busy={false}
            onTrust={options.onTrust}
            onForwardFinding={options.onForwardFinding}
            jobHref={options.jobHref}
          />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    // The thread is read on mount.
    await waitFor(() => check(links.calls).toContain("listProjectErrorThread"));
    return { links };
  };

  it("draws events and comments as one timeline, oldest first, Lore's own included", async ({
    expect,
  }) => {
    await show(
      detail({ trustedAt: "2026-11-02T10:00:00.000Z", trustedBy: ADA }),
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("error-thread-comment")).toHaveLength(2),
    );
    const kinds = screen
      .getAllByTestId("error-thread-event")
      .map((row) => row.getAttribute("data-kind"));
    // The first report is read from the row; the rest is the thread's.
    expect(kinds).toEqual([
      "first_reported",
      "trusted",
      "forwarded",
      "handed_back",
      "run_resolved",
    ]);
    const lines = screen
      .getAllByTestId("error-thread-event")
      .map((row) => row.textContent ?? "");
    expect(lines[0]).toContain("First reported");
    expect(lines[1]).toContain("Ada trusted this error");
    expect(lines[2]).toContain("Ada forwarded this error to a new quest");
    // Lore's own changes name no member.
    expect(lines[3]).toContain(
      "Lore reopened this error: its quest was deleted",
    );
    expect(lines[4]).toContain("Lore resolved this error: a run passed");
    // The quest of the forward is a link; the deleted one's is not.
    const forwarded = screen.getAllByTestId("error-thread-event")[2]!;
    expect(forwarded.querySelector("a")?.getAttribute("href")).toBe(
      "/acme/quests/12",
    );
    expect(
      screen.getAllByTestId("error-thread-event")[3]!.querySelector("a"),
    ).toBeNull();
  });

  it("names a deleted account's verb as a former member's, and never Lore's own change", async ({
    expect,
  }) => {
    await show(detail({ trustedAt: "2026-11-02T10:00:00.000Z" }), {
      entries: [
        // The account is gone: the foreign key cleared the actor.
        {
          type: "event",
          id: 1,
          at: "2026-11-02T10:00:00.000Z",
          kind: "resolved",
        },
        // The account is there, with no name left to show.
        {
          type: "event",
          id: 2,
          at: "2026-11-03T10:00:00.000Z",
          kind: "trusted",
          userId: ADA,
        },
        {
          type: "event",
          id: 3,
          at: "2026-11-04T10:00:00.000Z",
          kind: "run_reopened",
        },
      ],
    });

    const lines = await waitFor(() => {
      const rows = screen.getAllByTestId("error-thread-event");
      expect(rows.length).toBeGreaterThanOrEqual(4);
      return rows.map((row) => row.textContent ?? "");
    });
    const said = (kind: string) =>
      lines[
        screen
          .getAllByTestId("error-thread-event")
          .findIndex((row) => row.getAttribute("data-kind") === kind)
      ] ?? "";
    expect(said("resolved")).toContain("A former member resolved this error");
    expect(said("trusted")).toContain("A former member trusted this error");
    expect(said("run_reopened")).not.toContain("former member");
    expect(said("run_reopened")).toContain("Lore reopened this error");
  });

  it("shows a member's comment as markdown and an agent's with its mark", async ({
    expect,
  }) => {
    await show(
      detail({ trustedAt: "2026-11-02T10:00:00.000Z", trustedBy: ADA }),
    );

    const [members, agents] = await waitFor(() => {
      const cards = screen.getAllByTestId("error-thread-comment");
      expect(cards).toHaveLength(2);
      return cards;
    });
    expect(members!.textContent).toContain("Bob");
    await waitFor(() =>
      expect(members!.querySelector("strong")?.textContent).toBe("deploy"),
    );
    expect(within(members!).queryByText("agent")).toBeNull();
    // The account is Ada's; the words are a machine's, and the card says so.
    expect(agents!.textContent).toContain("Ada");
    expect(within(agents!).getByText("agent")).toBeTruthy();
  });

  it("reads a server error trusted by nobody as trusted on arrival", async ({
    expect,
  }) => {
    await show(
      detail({ origin: "server", trustedAt: "2026-11-01T10:00:00.000Z" }),
      { entries: [] },
    );

    expect(
      screen
        .getAllByTestId("error-thread-event")
        .map((row) => row.getAttribute("data-kind")),
    ).toEqual(["first_reported", "trusted_on_arrival"]);
    expect(screen.queryByTestId("error-untrusted-notice")).toBeNull();
  });

  it("says no agent reads an untrusted error, with the Trust button for who may triage", async ({
    expect,
  }) => {
    let trusted = 0;
    await show(detail(), { entries: [], onTrust: () => (trusted += 1) });

    const notice = screen.getByTestId("error-untrusted-notice");
    expect(notice.textContent).toContain("No agent reads this error yet");
    fireEvent.click(screen.getByTestId("error-untrusted-trust"));
    expect(trusted).toBe(1);
  });

  it("shows a member who may not triage the notice without its button, and still the composer", async ({
    expect,
  }) => {
    await show(detail(), { entries: [] });

    expect(screen.getByTestId("error-untrusted-notice")).toBeTruthy();
    expect(screen.queryByTestId("error-untrusted-trust")).toBeNull();
    // Reading errors is enough to write on one.
    expect(
      document.querySelector('[data-slot="discussion-composer"]'),
    ).toBeTruthy();
  });

  it("shows an agent run that has not answered where it was asked for, linked for who may read jobs", async ({
    expect,
  }) => {
    const JOB = "00000000-0000-4000-8000-00000000a0b1";
    await show(
      detail({ trustedAt: "2026-11-02T10:00:00.000Z", trustedBy: ADA }),
      {
        jobs: [
          {
            id: JOB,
            status: "running",
            prompt: "investigate-error",
            queuedAt: "2026-11-03T12:00:00.000Z",
          },
        ],
        jobHref: (jobId) => `/acme/jobs/${jobId}`,
      },
    );

    const run = await screen.findByTestId("error-thread-job");
    expect(run.getAttribute("data-status")).toBe("running");
    expect(run.textContent).toContain("An agent is investigating");
    expect(
      within(run).getByTestId("error-thread-job-link").getAttribute("href"),
    ).toBe(`/acme/jobs/${JOB}`);
    // Between Bob's comment of the 3rd at 10:00 and the agent's of the 4th.
    const order = [
      ...document.querySelectorAll(
        '[data-testid="error-thread-job"], [data-testid="error-thread-comment"]',
      ),
    ].map((line) => line.getAttribute("data-status") ?? "comment");
    expect(order).toEqual(["comment", "running", "comment"]);
  });

  it("names a failed run without a link for a member who may not read jobs", async ({
    expect,
  }) => {
    await show(
      detail({ trustedAt: "2026-11-02T10:00:00.000Z", trustedBy: ADA }),
      {
        entries: [],
        jobs: [
          {
            id: "00000000-0000-4000-8000-00000000a0b2",
            status: "failed",
            queuedAt: "2026-11-03T12:00:00.000Z",
          },
        ],
      },
    );

    const run = await screen.findByTestId("error-thread-job");
    expect(run.textContent).toContain("An agent run failed");
    expect(within(run).queryByTestId("error-thread-job-link")).toBeNull();
  });

  it("offers Forward to quest with this finding on an agent's comment only, and not once the error is forwarded", async ({
    expect,
  }) => {
    const forwarded: number[] = [];
    await show(
      detail({ trustedAt: "2026-11-02T10:00:00.000Z", trustedBy: ADA }),
      { onForwardFinding: (commentId) => forwarded.push(commentId) },
    );
    const [members, agents] = await waitFor(() => {
      const cards = screen.getAllByTestId("error-thread-comment");
      expect(cards).toHaveLength(2);
      return cards;
    });
    expect(
      within(members!).queryByTestId("error-thread-comment-forward"),
    ).toBeNull();
    const button = within(agents!).getByTestId("error-thread-comment-forward");
    expect(button.textContent).toContain("Forward to quest with this finding");
    fireEvent.click(button);
    expect(forwarded).toEqual([11]);

    cleanup();
    await alepha?.stop();
    await show(
      detail({
        trustedAt: "2026-11-02T10:00:00.000Z",
        trustedBy: ADA,
        status: "quest:900",
      }),
      { onForwardFinding: (commentId) => forwarded.push(commentId) },
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("error-thread-comment")).toHaveLength(2),
    );
    expect(screen.queryByTestId("error-thread-comment-forward")).toBeNull();
  });

  it("offers the delete on the viewer's own comment only, and asks first", async ({
    expect,
  }) => {
    const { links } = await show(
      detail({ trustedAt: "2026-11-02T10:00:00.000Z", trustedBy: ADA }),
      { viewer: BOB },
    );

    const buttons = await waitFor(() => {
      const found = screen.getAllByTestId("error-thread-comment-delete");
      expect(found).toHaveLength(1);
      return found;
    });
    // Bob's, not the agent's comment written as Ada.
    expect(
      buttons[0]!.closest('[data-testid="error-thread-comment"]')?.textContent,
    ).toContain("Bob");

    fireEvent.click(buttons[0]!);
    expect(links.calls).not.toContain("deleteProjectErrorComment");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(links.calls).toContain("deleteProjectErrorComment"),
    );
    expect(
      links.args.find((it) => it.name === "deleteProjectErrorComment")?.args,
    ).toEqual([{ params: { projectId: 1, errorId: 42, commentId: 10 } }]);
  });

  it("hides the composer from a caller the API would refuse", async ({
    expect,
  }) => {
    await show(detail(), {
      entries: [],
      denied: ["createProjectErrorComment"],
    });

    expect(
      document.querySelector('[data-slot="discussion-composer"]'),
    ).toBeNull();
  });
});
