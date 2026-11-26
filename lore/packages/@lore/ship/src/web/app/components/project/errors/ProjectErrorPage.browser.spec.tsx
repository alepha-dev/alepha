import { DialogProvider, Toaster } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import {
  currentProjectAtom,
  ElementReferenceRegistry,
  I18n,
  PinnedPromptsSlot,
  StackTraceParser,
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
import { $page, AlephaReactRouter, ReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { ProjectErrorDetail } from "../../../../../api/schemas/projectErrorDetailSchema.ts";
import type { ProjectErrorTrend } from "../../../../../api/schemas/projectErrorTrendSchema.ts";
import ProjectErrorPage from "./ProjectErrorPage.tsx";

/**
 * Answers what a case set, records what the page called, and refuses the
 * triage verbs for the viewer case.
 */
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

class RecordingRouter extends ReactRouter<object> {
  public pushed: string[] = [];

  public override async push(target: any): Promise<void> {
    this.pushed.push(target);
  }
}

/**
 * The pages the error page points at, by the names it uses. Ship's own and
 * the two of Plan and of Requirements its rail links.
 */
class Routes {
  projectErrors = $page({
    name: "projectErrors",
    path: "/:projectSlug/errors",
    component: () => null,
  });
  projectError = $page({
    name: "projectError",
    path: "/:projectSlug/errors/:errorId",
    component: () => null,
  });
  projectQuest = $page({
    name: "projectQuest",
    path: "/:projectSlug/quests/:shortId",
    component: () => null,
  });
  projectUseCase = $page({
    name: "projectUseCase",
    path: "/:projectSlug/requirements/use-cases/:useCaseNumber",
    component: () => null,
  });
  projectMonitor = $page({
    name: "projectMonitor",
    path: "/:projectSlug/uptime/:monitorId",
    component: () => null,
  });
  app = $page({
    name: "app",
    path: "/:projectSlug/apps/:app/:env",
    component: () => null,
  });
}

const SIGIL = "00000000-0000-4000-8000-000000000001";
const MONITOR = "00000000-0000-4000-8000-0000000000aa";

const detail = (
  over: Omit<Partial<ProjectErrorDetail>, "error"> & {
    error?: Partial<ProjectErrorDetail["error"]>;
  } = {},
): ProjectErrorDetail => {
  const { error, ...rest } = over;
  return {
    kind: "sigil",
    apps: [
      {
        sigilId: SIGIL,
        label: "acme/production",
        count: 5,
        firstSeenAt: "2026-11-01T10:00:00.000Z",
        lastSeenAt: "2026-11-20T10:00:00.000Z",
      },
    ],
    rules: [],
    ...rest,
    error: {
      id: 42,
      sigilId: SIGIL,
      fingerprint: "abcdef0123456789abcdef",
      name: "TypeError",
      message: "cart is undefined",
      stack: "TypeError: cart is undefined\n    at checkout (app.js:12:3)",
      sourceUrl: "https://acme.example/cart",
      origin: "server",
      firstSeenAt: "2026-11-01T10:00:00.000Z",
      lastSeenAt: "2026-11-20T10:00:00.000Z",
      count: 7,
      status: "open",
      trustedAt: "2026-11-01T10:00:00.000Z",
      ...error,
    } as ProjectErrorDetail["error"],
  };
};

const trend = (): ProjectErrorTrend => ({
  empty: false,
  series: [
    { at: "2026-11-18", value: 0 },
    { at: "2026-11-19", value: 4 },
    { at: "2026-11-20", value: 3 },
  ],
  markers: [{ at: "2026-11-19T12:00:00.000Z", kind: "deploy" }],
  total: 7,
});

/**
 * The error page (#E185): what each kind of error shows, what a viewer is
 * offered, and where each verb lands.
 */
describe("ProjectErrorPage", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  /**
   * The header's own badges: the rail says the status and the origin too.
   */
  const header = () => within(screen.getByTestId("error-header"));

  const show = async (
    subject: ProjectErrorDetail,
    options: {
      trend?: ProjectErrorTrend;
      denied?: string[];
      capabilities?: Array<"plan" | "ship">;
      responses?: Record<string, unknown>;
    } = {},
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with({ provide: ReactRouter, use: RecordingRouter })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(Routes);
    alepha.inject(I18n);
    // The stack viewer's parser: injected by a hook at render, so it has to
    // exist before the container locks.
    alepha.inject(StackTraceParser);
    // The thread's editor and viewer resolve `[[...]]` references through
    // it, from a hook at render too.
    alepha.inject(ElementReferenceRegistry);
    // The header's robot button reads core's pins slot at render. Unfilled
    // here, as in a Lore without Prompts: the button draws nothing.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({
        slug: "acme",
        capabilities: options.capabilities ?? ["plan", "ship"],
      }),
    );
    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = {
      getProjectError: subject,
      getProjectErrorTrend: options.trend ?? {
        empty: true,
        series: [],
        markers: [],
        total: 0,
      },
      countOpenProjectErrors: { count: 3 },
      // The thread under the stack: its own spec is
      // `ProjectErrorThread.browser.spec.tsx`.
      listProjectErrorThread: { entries: [] },
      getProjectUsers: [],
      forwardProjectErrorToQuest: { questId: 900, questShortId: 12 },
      ...options.responses,
    };
    for (const name of options.denied ?? []) links.denied.add(name);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster visibleToasts={20} />
          <ProjectErrorPage detail={subject} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    return {
      links,
      router: alepha.inject(ReactRouter) as RecordingRouter,
    };
  };

  it("renders a server error: where it stands, its counts, trend, stack and apps", async ({
    expect,
  }) => {
    await show(detail({ previousId: 41, nextId: 43 }), { trend: trend() });

    expect(screen.getByTestId("error-name").textContent).toBe("TypeError");
    expect(screen.getByTestId("error-message").textContent).toBe(
      "cart is undefined",
    );
    expect(screen.getByTestId("error-number").textContent).toBe("Error #42");
    expect(header().getByTestId("error-status").textContent).toBe("Open");
    expect(header().getByTestId("error-origin").textContent).toBe("Server");
    expect(screen.getByTestId("error-count").textContent).toBe("7");
    // Trusted with nobody behind it: on arrival.
    expect(screen.getByTestId("error-rail-trust").textContent).toContain(
      "Trusted on arrival",
    );
    expect(
      screen
        .getByTestId("error-rail-app")
        .querySelector("a")
        ?.getAttribute("href"),
    ).toBe("/acme/apps/acme/production");
    expect(screen.getByTestId("error-stack").textContent).toContain("checkout");
    // The walk through the open inbox.
    expect(
      screen.getByTestId("error-previous").closest("a")?.getAttribute("href"),
    ).toBe("/acme/errors/41");
    expect(
      screen.getByTestId("error-next").closest("a")?.getAttribute("href"),
    ).toBe("/acme/errors/43");
    // The thirty days, with the deploy as a marker.
    await waitFor(() =>
      expect(screen.getAllByTestId("tile-chart-bar")).toHaveLength(3),
    );
    expect(screen.getAllByTestId("tile-chart-marker")).toHaveLength(1);
  });

  it("renders a browser error awaiting trust, linked to the server error of its request", async ({
    expect,
  }) => {
    await show(
      detail({
        error: {
          origin: "client",
          trustedAt: undefined,
          linkedError: { id: 77, origin: "server" },
        },
      }),
    );

    expect(header().getByTestId("error-origin").textContent).toBe("Browser");
    expect(screen.getByTestId("error-untrusted")).toBeTruthy();
    expect(screen.getByTestId("error-rail-trust").textContent).toContain(
      "Awaiting trust",
    );
    const linked = screen.getByTestId("error-rail-linked").querySelector("a");
    expect(linked?.textContent).toBe("Caused by server error #77");
    expect(linked?.getAttribute("href")).toBe("/acme/errors/77");
    // No series read yet, or none at all: no chart is drawn empty.
    expect(screen.queryByTestId("error-trend")).toBeNull();
  });

  it("renders an uptime error as a monitor's: no app, no trend, a link to its monitor", async ({
    expect,
  }) => {
    await show(
      detail({
        kind: "uptime",
        apps: [],
        monitor: { id: MONITOR },
        error: {
          name: "UptimeOutage",
          message: "Home: status: HTTP 500",
          fingerprint: `uptime:1:${MONITOR}`,
          trustedAt: undefined,
        },
      }),
    );

    expect(header().getByTestId("error-origin").textContent).toBe("Monitor");
    expect(screen.queryByTestId("error-rail-apps")).toBeNull();
    expect(screen.queryByTestId("error-trend")).toBeNull();
    expect(
      screen
        .getByTestId("error-rail-monitor")
        .querySelector("a")
        ?.getAttribute("href"),
    ).toBe(`/acme/uptime/${MONITOR}`);
    // Four numbers become three: no app reports a monitor's outage.
    expect(screen.getByTestId("error-counts").textContent).not.toContain(
      "Apps",
    );
  });

  it("renders a run error with its use case and criterion, and no app", async ({
    expect,
  }) => {
    await show(
      detail({
        kind: "run",
        apps: [],
        run: {
          useCaseRunId: 41,
          criterionKey: "C2",
          useCase: { number: 5, title: "Check out a basket" },
        },
        error: {
          origin: "run",
          name: "CriterionFailed",
          fingerprint: "usecase:9:C2",
          trustedAt: undefined,
        },
      }),
    );

    expect(header().getByTestId("error-origin").textContent).toBe(
      "Use case run",
    );
    const run = screen.getByTestId("error-rail-run");
    expect(run.textContent).toContain("C2");
    expect(run.querySelector("a")?.textContent).toBe("Check out a basket");
    expect(run.querySelector("a")?.getAttribute("href")).toBe(
      "/acme/requirements/use-cases/5",
    );
    expect(screen.queryByTestId("error-rail-apps")).toBeNull();
  });

  it("names the quest of a forwarded error with its status, and offers no forward", async ({
    expect,
  }) => {
    await show(
      detail({
        quest: {
          id: 900,
          shortId: 12,
          title: "Fix the cart",
          status: "in_progress",
        },
        error: { status: "quest:900" },
      }),
    );

    expect(header().getByTestId("error-status").textContent).toBe(
      "Forwarded to a quest",
    );
    const quest = screen.getByTestId("error-rail-quest");
    expect(quest.querySelector("a")?.getAttribute("href")).toBe(
      "/acme/quests/12",
    );
    expect(quest.textContent).toContain("#Q12 Fix the cart");
    expect(quest.textContent).toContain("In progress");
    expect(screen.queryByTestId("error-resolve")).toBeNull();
    expect(screen.queryByTestId("error-forward")).toBeNull();
    // Not open: in no queue, so no walk.
    expect(screen.queryByTestId("error-previous")).toBeNull();
  });

  it("says a resolved error was seen again, with the date of the resolve, and nothing on one silent since", async ({
    expect,
  }) => {
    await show(
      detail({
        error: {
          status: "resolved",
          resolvedAt: "2026-11-10T09:00:00.000Z",
          seenAgain: true,
        },
      }),
    );

    expect(header().getByTestId("error-status").textContent).toBe("Resolved");
    const mark = header().getByTestId("error-seen-again").textContent ?? "";
    expect(mark).toContain("Seen again since resolved on");
    expect(mark).toContain("2026");

    cleanup();
    await alepha?.stop();
    await show(
      detail({
        error: { status: "resolved", resolvedAt: "2026-11-21T09:00:00.000Z" },
      }),
    );
    expect(header().getByTestId("error-status").textContent).toBe("Resolved");
    expect(screen.queryByTestId("error-seen-again")).toBeNull();
  });

  it("offers a viewer no verb, and still shows them the whole error", async ({
    expect,
  }) => {
    await show(detail({ rules: [{ id: 1, pattern: "cart", createdAt: "" }] }), {
      denied: ["resolveProjectError"],
    });

    expect(screen.getByTestId("error-name").textContent).toBe("TypeError");
    expect(screen.getByTestId("error-stack")).toBeTruthy();
    expect(screen.getByTestId("error-rail-rule").textContent).toBe("cart");
    for (const control of [
      "error-resolve",
      "error-forward",
      "error-more",
      "error-rail-ignore",
    ]) {
      expect(screen.queryByTestId(control), control).toBeNull();
    }
  });

  it("hides both ways of forwarding when the project has no Plan", async ({
    expect,
  }) => {
    await show(detail(), { capabilities: ["ship"] });

    expect(screen.getByTestId("error-resolve")).toBeTruthy();
    expect(screen.queryByTestId("error-forward")).toBeNull();
    expect(screen.queryByTestId("error-rail-quest")).toBeNull();
  });

  it("shows the error's text as text: no markup, and the page address is no link", async ({
    expect,
  }) => {
    await show(
      detail({
        error: {
          name: "<img src=x onerror=alert(1)>",
          message: "[click](javascript:alert(1)) **bold**",
          sourceUrl: "https://evil.example/phish",
          stack: "<script>alert(1)</script>\n    at x (y.js:1:1)",
        },
      }),
    );

    const page = screen.getByTestId("error-page");
    expect(page.querySelector("img")).toBeNull();
    expect(page.querySelector("script")).toBeNull();
    expect(page.querySelector("strong")).toBeNull();
    expect(screen.getByTestId("error-name").textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(screen.getByTestId("error-message").textContent).toBe(
      "[click](javascript:alert(1)) **bold**",
    );
    // Shown, and never an anchor: every link on the page is one of Lore's.
    expect(page.textContent).toContain("https://evil.example/phish");
    for (const anchor of page.querySelectorAll("a")) {
      expect(anchor.getAttribute("href")).toMatch(/^\/acme\//);
    }
  });

  it("resolves from the page, stays on it and reads it again", async ({
    expect,
  }) => {
    const { links, router } = await show(detail());

    fireEvent.click(screen.getByTestId("error-resolve"));

    await waitFor(() => expect(links.calls).toContain("resolveProjectError"));
    await waitFor(() =>
      expect(
        links.calls.filter((name) => name === "getProjectError").length,
      ).toBeGreaterThan(0),
    );
    expect(
      links.args.find((it) => it.name === "resolveProjectError")?.args,
    ).toEqual([{ params: { projectId: 1, errorId: 42 } }]);
    // The sidebar's count follows, and nobody left the page.
    await waitFor(() =>
      expect(links.calls).toContain("countOpenProjectErrors"),
    );
    expect(router.pushed).toEqual([]);
  });

  it("deletes after a confirmation, and goes back to the inbox", async ({
    expect,
  }) => {
    const { links, router } = await show(detail());

    fireEvent.click(screen.getByTestId("error-more"));
    fireEvent.click(await screen.findByTestId("error-delete"));
    // Nothing is sent before the member confirms.
    expect(links.calls).not.toContain("deleteProjectError");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(links.calls).toContain("deleteProjectError"));
    await waitFor(() => expect(router.pushed).toEqual(["projectErrors"]));
  });
});
