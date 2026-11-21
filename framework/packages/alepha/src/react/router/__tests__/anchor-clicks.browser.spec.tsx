import {
  act,
  fireEvent,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { beforeEach, describe, it, vi } from "vitest";

import { AlephaContext } from "../../core/contexts/AlephaContext.ts";
import { $page, Link, ReactRouter, useActive } from "../index.browser.ts";

const setup = async () => {
  class App {
    home = $page({
      path: "/",
      component: () => <div>Home</div>,
    });

    about = $page({
      path: "/about",
      component: () => <div>About</div>,
    });
  }

  const alepha = Alepha.create().with(AlephaReact).with(App);
  await alepha.start();

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AlephaContext.Provider value={alepha}>{children}</AlephaContext.Provider>
  );

  return { alepha, router: alepha.inject(ReactRouter), wrapper };
};

const clickEvent = (init: Partial<MouseEvent> = {}) => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...init,
});

describe("anchor click semantics", () => {
  beforeEach(() => {
    // jsdom shares window.history across tests: a previous test's SPA
    // navigation must not leak into this one's isActive checks.
    window.history.replaceState({}, "", "/");
  });
  it("router.anchor() lets modified clicks fall through to the browser", async ({
    expect,
  }) => {
    const { router } = await setup();
    const props = router.anchor("/about");

    // cmd/ctrl-click means "open in a new tab": the SPA must not hijack it.
    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const ev = clickEvent(init);
      props.onClick?.(ev);
      expect(ev.preventDefault).not.toHaveBeenCalled();
    }
  });

  it("router.anchor() still SPA-navigates on plain clicks", async ({
    expect,
  }) => {
    const { router } = await setup();
    const props = router.anchor("/about");

    const ev = clickEvent();
    props.onClick?.(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it("router.anchor() respects target=_blank anchors", async ({ expect }) => {
    const { router } = await setup();
    const props = router.anchor("/about");

    const ev = clickEvent({
      currentTarget: { target: "_blank" } as never,
    });
    props.onClick?.(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("<Link> runs the caller's onClick", async ({ expect }) => {
    const { wrapper } = await setup();
    const onClick = vi.fn();

    const { getByText } = render(
      <Link href="/about" onClick={onClick}>
        go
      </Link>,
      { wrapper },
    );

    fireEvent.click(getByText("go"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("<Link> skips SPA navigation when the caller prevented default", async ({
    expect,
  }) => {
    const { wrapper, router } = await setup();

    const { getByText } = render(
      <>
        <Link href="/about" onClick={(ev) => ev.preventDefault()}>
          stay
        </Link>
        <Link href="/about">go</Link>
      </>,
      { wrapper },
    );

    // Long enough for a navigation to land, had one started.
    await act(async () => {
      fireEvent.click(getByText("stay"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(router.isActive("/about")).toBe(false);

    // The same link without the caller's `preventDefault` does navigate.
    await act(async () => {
      fireEvent.click(getByText("go"));
    });
    await waitFor(() => expect(router.isActive("/about")).toBe(true));
  });

  it("useActive anchorProps let modified clicks fall through", async ({
    expect,
  }) => {
    const { wrapper } = await setup();

    const { result } = renderHook(() => useActive("/about"), { wrapper });

    const ev = clickEvent({ metaKey: true });
    result.current.anchorProps.onClick?.(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});
