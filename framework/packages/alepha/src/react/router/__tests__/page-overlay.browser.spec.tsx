import { Alepha, z } from "alepha";
import { AlephaReact } from "alepha/react";
import { act, createContext, use } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  $page,
  NestedView,
  ReactBrowserProvider,
  ReactRouter,
  useOverlay,
  useRouter,
  useRouterState,
} from "../index.browser.ts";

// Context exemption: a stand-in for what a real layout provides to its subtree.
const LayoutContext = createContext("none");

describe("$page overlay", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  const text = () => document.getElementById("root")?.textContent;

  const log: string[] = [];
  let boardLoads = 0;

  const Board = () => {
    const state = useRouterState();
    return <div data-testid="board">Board[{state.name}]</div>;
  };

  // The same DOM node is the proof the board did not remount.
  const board = () => document.querySelector('[data-testid="board"]');

  const Sheet = (props: { id: string }) => {
    const { close } = useOverlay();
    const router = useRouter();
    return (
      <div data-testid="sheet" data-layout={use(LayoutContext)}>
        <span>Sheet {props.id}</span>
        <button data-testid="close" type="button" onClick={close} />
        <button
          data-testid="query"
          type="button"
          onClick={() => router.setQueryParams({ tab: "x" })}
        />
      </div>
    );
  };

  class App {
    layout = $page({
      component: () => (
        <LayoutContext value="layout">
          <div>
            <NestedView />
          </div>
        </LayoutContext>
      ),
    });

    board = $page({
      parent: this.layout,
      path: "/board",
      loader: async () => {
        boardLoads += 1;
        return {};
      },
      onLeave: () => {
        log.push("board:leave");
      },
      component: Board,
    });

    other = $page({
      parent: this.layout,
      path: "/other",
      component: () => <div>Other</div>,
    });

    card = $page({
      parent: this.layout,
      path: "/cards/:id",
      schema: { params: z.object({ id: z.text() }) },
      loader: async ({ params }) => {
        if (params.id === "missing") {
          throw new Error("nope");
        }
        return { id: params.id };
      },
      onEnter: () => {
        log.push("card:enter");
      },
      onLeave: () => {
        log.push("card:leave");
      },
      errorHandler: () => <div>Card failed</div>,
      component: (props: { id: string }) => <div>Page {props.id}</div>,
      overlay: {
        over: () => [this.board],
        component: Sheet,
      },
    });
  }

  const start = async () => {
    log.length = 0;
    boardLoads = 0;
    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });
    const router = alepha.inject(ReactRouter);
    await act(async () => {
      await router.push("/board");
    });
    return { alepha, router };
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  const back = async () => {
    await act(async () => {
      window.history.back();
      await settle();
      await settle();
    });
  };

  const forward = async () => {
    await act(async () => {
      window.history.forward();
      await settle();
      await settle();
    });
  };

  it("opens over the page, which stays mounted and committed", async () => {
    const { alepha, router } = await start();
    const loads = boardLoads;
    const node = board();

    await act(async () => {
      await router.push("/cards/1");
    });

    expect(text()).toBe("Board[board]Sheet 1");
    expect(window.location.pathname).toBe("/cards/1");
    expect(board()).toBe(node);
    expect(boardLoads).toBe(loads);
    expect(router.state.name).toBe("board");
    expect(router.state.url.pathname).toBe("/board");
    expect(router.state.overlay?.name).toBe("card");
    expect(alepha.inject(ReactBrowserProvider).history.state.background).toBe(
      "/board",
    );
  });

  it("renders under its parents' layouts", async () => {
    const { router } = await start();

    await act(async () => {
      await router.push("/cards/1");
    });

    expect(
      document
        .querySelector('[data-testid="sheet"]')
        ?.getAttribute("data-layout"),
    ).toBe("layout");
  });

  it("is a full page from anywhere else", async () => {
    const { router } = await start();

    await act(async () => {
      await router.push("/other");
    });
    await act(async () => {
      await router.push("/cards/1");
    });

    expect(text()).toBe("Page 1");
    expect(router.state.overlay).toBeUndefined();
    expect(router.state.name).toBe("card");
  });

  it("closes with Back and reopens with Forward", async () => {
    const { router } = await start();
    const node = board();

    await act(async () => {
      await router.push("/cards/1");
    });
    await back();

    expect(text()).toBe("Board[board]");
    expect(window.location.pathname).toBe("/board");
    expect(router.state.overlay).toBeUndefined();
    expect(board()).toBe(node);

    await forward();

    expect(text()).toBe("Board[board]Sheet 1");
    expect(board()).toBe(node);
  });

  it("closes through useOverlay", async () => {
    const { router } = await start();

    await act(async () => {
      await router.push("/cards/1");
    });
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="close"]')?.click();
      await settle();
      await settle();
    });

    expect(text()).toBe("Board[board]");
  });

  it("fires the overlay's onLeave and not the background's", async () => {
    const { router } = await start();

    await act(async () => {
      await router.push("/cards/1");
    });
    expect(log).toEqual(["card:enter"]);

    await back();
    expect(log).toEqual(["card:enter", "card:leave"]);
  });

  it("stays an overlay on a push from inside it", async () => {
    const { router } = await start();
    const node = board();

    await act(async () => {
      await router.push("/cards/1");
    });
    await act(async () => {
      await router.push("/cards/2");
    });

    expect(text()).toBe("Board[board]Sheet 2");
    expect(board()).toBe(node);
    // One overlay leaving for the same page is not a leave.
    expect(log).toEqual(["card:enter"]);

    await back();
    expect(text()).toBe("Board[board]Sheet 1");
  });

  it("leaves on any other push", async () => {
    const { router } = await start();

    await act(async () => {
      await router.push("/cards/1");
    });
    await act(async () => {
      await router.push("/other");
    });

    expect(text()).toBe("Other");
    expect(router.state.overlay).toBeUndefined();
    expect(log).toEqual(["card:enter", "card:leave", "board:leave"]);
  });

  it("keeps the background entry through setQueryParams", async () => {
    const { alepha, router } = await start();

    await act(async () => {
      await router.push("/cards/1");
    });
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="query"]')?.click();
    });

    expect(window.location.pathname + window.location.search).toBe(
      "/cards/1?tab=x",
    );
    expect(router.query).toEqual({ tab: "x" });
    expect(router.state.url.pathname).toBe("/board");
    expect(alepha.inject(ReactBrowserProvider).history.state.background).toBe(
      "/board",
    );

    await back();
    expect(text()).toBe("Board[board]");
  });

  it("renders the page in full when the overlay's loader fails", async () => {
    const { router } = await start();

    await act(async () => {
      await router.push("/cards/missing");
    });

    expect(text()).toBe("Card failed");
    expect(router.state.overlay).toBeUndefined();
    expect(router.state.name).toBe("card");
  });

  it("re-runs only the overlay on invalidate", async () => {
    const { router } = await start();
    await act(async () => {
      await router.push("/cards/1");
    });
    const loads = boardLoads;

    await act(async () => {
      await router.invalidate();
    });

    expect(text()).toBe("Board[board]Sheet 1");
    expect(boardLoads).toBe(loads);
  });

  it("is a full page on a first screen, whatever the entry says", async () => {
    window.history.replaceState({ background: "/board" }, "", "/cards/1");

    const alepha = Alepha.create().with(AlephaReact).with(App);
    await act(async () => {
      await alepha.start();
    });

    expect(text()).toBe("Page 1");
    expect(window.history.state.background).toBeUndefined();
  });
});
