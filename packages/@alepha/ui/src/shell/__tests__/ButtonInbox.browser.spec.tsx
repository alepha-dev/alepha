import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { setupJsdomMocks } from "alepha/react/testing";
import { LinkProvider } from "alepha/server/links";
import { beforeAll, describe, expect, it } from "vitest";

import { ButtonInbox } from "../button-inbox.tsx";

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

  override client(): any {
    const actions: Record<string, any> = {
      countInbox: async () => ({ unread: this.unread }),
      listInbox: async () => ({ items: ROWS, unreadCount: this.unread }),
      markInboxRead: async (input: any) => {
        this.readCalls.push(input.params.id);
        return { ok: true };
      },
      markAllInboxRead: async () => {
        this.markAllCalls++;
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
        }) as any;
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
