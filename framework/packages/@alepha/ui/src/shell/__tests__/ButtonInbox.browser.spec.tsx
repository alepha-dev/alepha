import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ButtonInbox } from "../ButtonInbox.tsx";

const ROWS = [
  {
    id: "m-1",
    title: "Fabrice mentioned you in #Q402",
    href: "/alepha/quests/402",
    createdAt: "2026-09-07T02:00:00.000Z",
    scopeLabel: "Alepha",
  },
  {
    id: "m-2",
    title: "Alepha released 0.30.0",
    href: "/alepha/releases/0.30.0",
    createdAt: "2026-09-06T02:00:00.000Z",
    readAt: "2026-09-06T03:00:00.000Z",
    scopeLabel: "Alepha",
  },
];

/**
 * The whole server side, as a fake registry.
 *
 * `available` is what `countInbox.can()` answers, which is the render gate:
 * `/api/_links` carries only the actions the server registered, and prunes
 * secured ones for an anonymous caller, so `false` covers both "the module is
 * not installed" and "nobody is signed in".
 */
class Links extends LinkProvider {
  public available = true;
  public unread = 3;
  public readCalls: string[] = [];
  public markAllCalls = 0;
  public markAllError?: Error;
  public rows: typeof ROWS = ROWS;

  override client(): any {
    const actions: Record<string, any> = {
      countInbox: async () => ({ unread: this.unread }),
      listInbox: async () => ({
        items: this.rows,
        unreadCount: this.unread,
      }),
      markInboxRead: async (input: any) => {
        this.readCalls.push(input.params.id);
        return { ok: true };
      },
      markAllInboxRead: async () => {
        this.markAllCalls++;
        if (this.markAllError) throw this.markAllError;
        return { ok: true };
      },
    };
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, key: string) => {
        const action: any = actions[key] ?? (async () => ({}));
        action.can = () => this.available;
        return action;
      },
    });
  }
}

describe("ButtonInbox", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  const mount = async (
    props: Parameters<typeof ButtonInbox>[0] = {},
    configure?: (links: Links) => void,
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact);
    const links = alepha.inject(Links);
    configure?.(links);
    await alepha.start();

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ButtonInbox {...props} />
      </AlephaContext.Provider>,
    );
    return { view, links, alepha };
  };

  /**
   * ⚠️ The gate is a registry lookup, not a fetch. Without it every app that
   * mounts the cluster without `alepha/api/notifications` would 404 on every
   * page load.
   */
  it("renders nothing when countInbox is not available", async () => {
    const { view } = await mount({}, (links) => {
      links.available = false;
    });

    expect(view.container.innerHTML).toBe("");
  });

  it("shows the unread count as a filled badge", async () => {
    const { view } = await mount();

    await waitFor(() =>
      expect(view.getByTestId("inbox-badge").textContent).toBe("3"),
    );
  });

  it("caps the badge at 99+", async () => {
    const { view } = await mount({}, (links) => {
      links.unread = 412;
    });

    await waitFor(() =>
      expect(view.getByTestId("inbox-badge").textContent).toBe("99+"),
    );
  });

  it("shows no badge at zero", async () => {
    const { view } = await mount({}, (links) => {
      links.unread = 0;
    });

    await waitFor(() =>
      expect(view.container.querySelector("button")).toBeTruthy(),
    );
    expect(view.queryByTestId("inbox-badge")).toBeNull();
  });

  /**
   * A count nobody could read is zero. A bell that throws takes the header
   * with it.
   */
  it("treats a failed count as zero rather than an error", async () => {
    const { view } = await mount({}, (links) => {
      links.client = () =>
        new Proxy({} as Record<string, unknown>, {
          get: () => {
            const action: any = async () => {
              throw new Error("offline");
            };
            action.can = () => true;
            return action;
          },
        });
    });

    await waitFor(() =>
      expect(view.container.querySelector("button")).toBeTruthy(),
    );
    expect(view.queryByTestId("inbox-badge")).toBeNull();
  });

  it("lists the recent messages with their chip and unread dot", async () => {
    const { view } = await mount();

    fireEvent.click(view.container.querySelector("button")!);

    await waitFor(() =>
      expect(view.getByText("Fabrice mentioned you in #Q402")).toBeTruthy(),
    );
    expect(view.getByText("Alepha released 0.30.0")).toBeTruthy();
    // One unread of the two, so one dot.
    expect(view.getAllByTestId("inbox-unread-dot")).toHaveLength(1);
    expect(view.getAllByText("Alepha").length).toBeGreaterThan(0);
  });

  it("draws its header on the chrome surface, not as a row (#Q2497)", async () => {
    const { view } = await mount();
    fireEvent.click(view.container.querySelector("button")!);

    const header = await waitFor(() => view.getByTestId("inbox-header"));
    const classes = header.className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["chrome", "chrome-closed"]),
    );
    // Edge to edge over the menu's padding.
    expect(classes).toEqual(expect.arrayContaining(["-mx-1", "-mt-1"]));
  });

  it("marks a row read and opens it", async () => {
    const opened: string[] = [];
    const { view, links } = await mount({
      onOpen: (href) => opened.push(href),
    });

    fireEvent.click(view.container.querySelector("button")!);
    await waitFor(() =>
      expect(view.getByText("Fabrice mentioned you in #Q402")).toBeTruthy(),
    );
    fireEvent.click(view.getByText("Fabrice mentioned you in #Q402"));

    await waitFor(() => expect(opened).toEqual(["/alepha/quests/402"]));
    expect(links.readCalls).toEqual(["m-1"]);
  });

  /**
   * A row already read is not marked again: the endpoint would accept it, and
   * a write per click on an unchanged row is noise in the audit trail.
   */
  it("does not mark an already-read row", async () => {
    const opened: string[] = [];
    const { view, links } = await mount({
      onOpen: (href) => opened.push(href),
    });

    fireEvent.click(view.container.querySelector("button")!);
    await waitFor(() =>
      expect(view.getByText("Alepha released 0.30.0")).toBeTruthy(),
    );
    fireEvent.click(view.getByText("Alepha released 0.30.0"));

    await waitFor(() => expect(opened).toEqual(["/alepha/releases/0.30.0"]));
    expect(links.readCalls).toEqual([]);
  });

  it("marks everything read and clears the badge", async () => {
    const { view, links } = await mount();

    fireEvent.click(view.container.querySelector("button")!);
    await waitFor(() => expect(view.getByText("Mark all read")).toBeTruthy());
    fireEvent.click(view.getByText("Mark all read"));

    await waitFor(() => expect(links.markAllCalls).toBe(1));
    await waitFor(() => expect(view.queryByTestId("inbox-badge")).toBeNull());
  });

  /**
   * A host with unread counts of its own (a sidebar's, per scope) refreshes
   * them from `onRead`: the bell's own count is the only one it updates.
   */
  it("tells the host once messages were read, by Mark all read or by a row", async () => {
    const reads: string[] = [];
    const { view, links } = await mount({
      onOpen: () => {},
      onRead: () => reads.push("read"),
    });

    fireEvent.click(view.container.querySelector("button")!);
    await waitFor(() => expect(view.getByText("Mark all read")).toBeTruthy());
    fireEvent.click(view.getByText("Fabrice mentioned you in #Q402"));
    await waitFor(() => expect(links.readCalls).toEqual(["m-1"]));
    await waitFor(() => expect(reads).toHaveLength(1));

    fireEvent.click(view.container.querySelector("button")!);
    await waitFor(() => expect(view.getByText("Mark all read")).toBeTruthy());
    fireEvent.click(view.getByText("Mark all read"));
    await waitFor(() => expect(links.markAllCalls).toBe(1));
    await waitFor(() => expect(reads).toHaveLength(2));
  });

  it("does not tell the host when Mark all read is refused", async () => {
    const reads: string[] = [];
    const { view, links } = await mount(
      { onRead: () => reads.push("read") },
      (links) => {
        links.markAllError = new Error("refused");
      },
    );

    fireEvent.click(view.container.querySelector("button")!);
    await waitFor(() => expect(view.getByText("Mark all read")).toBeTruthy());
    fireEvent.click(view.getByText("Mark all read"));
    await waitFor(() => expect(links.markAllCalls).toBe(1));
    expect(reads).toEqual([]);
  });

  /**
   * The write is the truth: a refused "Mark all read" leaves the badge and
   * the dots as they were, and the failure reaches `react:action:error`
   * (which a mounted `ActionErrorToaster` toasts) instead of being lost.
   */
  it("keeps the badge and the rows when marking all read fails", async () => {
    const { view, links, alepha } = await mount({}, (links) => {
      links.markAllError = new Error("refused");
    });
    const errors: Error[] = [];
    alepha.events.on("react:action:error", (event) => {
      errors.push(event.error);
    });

    fireEvent.click(view.container.querySelector("button")!);
    await waitFor(() => expect(view.getByText("Mark all read")).toBeTruthy());
    fireEvent.click(view.getByText("Mark all read"));

    await waitFor(() =>
      expect(errors.map((e) => e.message)).toEqual(["refused"]),
    );
    expect(links.markAllCalls).toBe(1);
    expect(view.getByTestId("inbox-badge").textContent).toBe("3");
    expect(view.getAllByTestId("inbox-unread-dot")).toHaveLength(1);
  });

  /**
   * Without `onOpen` the row is a full navigation to whatever `href` the
   * message carries, and that string was written at send time. Only a path
   * or an http(s) URL is followed: a `javascript:` one would run on the
   * app's origin.
   */
  it("follows only a path or an http(s) href without onOpen", async () => {
    const assign = vi.fn();
    const location = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: location.href,
        origin: location.origin,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        assign,
      },
    });
    try {
      const hrefs = [
        "javascript:alert(document.cookie)",
        "//evil.example/x",
        "/\\evil.example/x",
        "data:text/html,hi",
        "/alepha/quests/402",
        "https://example.app/x",
      ];
      const { view } = await mount({}, (links) => {
        links.rows = hrefs.map((href, i) => ({
          id: `h-${i}`,
          title: `Row ${i}`,
          href,
          createdAt: "2026-09-07T02:00:00.000Z",
          readAt: "2026-09-07T03:00:00.000Z",
          scopeLabel: "Alepha",
        }));
      });

      for (let i = 0; i < hrefs.length; i++) {
        fireEvent.click(view.container.querySelector("button")!);
        await waitFor(() => expect(view.getByText(`Row ${i}`)).toBeTruthy());
        fireEvent.click(view.getByText(`Row ${i}`));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(assign.mock.calls.map((call) => call[0])).toEqual([
        "/alepha/quests/402",
        "https://example.app/x",
      ]);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: location,
      });
    }
  });

  it("hides the footer without a destination, and shows it with one", async () => {
    const bare = await mount();
    fireEvent.click(bare.view.container.querySelector("button")!);
    await waitFor(() =>
      expect(bare.view.getByText("Alepha released 0.30.0")).toBeTruthy(),
    );
    expect(bare.view.queryByText("See all")).toBeNull();
    await bare.alepha.stop();

    const withFooter = await mount({ seeAllHref: "/alepha/inbox?all=1" });
    fireEvent.click(withFooter.view.container.querySelector("button")!);
    await waitFor(() =>
      expect(withFooter.view.getByText("See all")).toBeTruthy(),
    );
  });

  it("takes its labels as its own props", async () => {
    const { view } = await mount({
      labels: { inbox: "Notifications FR", heading: "Boîte" },
    });

    await waitFor(() =>
      expect(
        view.container.querySelector("[aria-label='Notifications FR']"),
      ).toBeTruthy(),
    );
  });
});
