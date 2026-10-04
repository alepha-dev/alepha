import { $hook, $inject, Alepha, type Service, z } from "alepha";
import { AlephaReact } from "alepha/react";
import { $page } from "alepha/react/router";
import { act } from "react";
import { beforeEach, describe, it } from "vitest";

import {
  AlephaCapacitor,
  CapacitorConfigProvider,
  DeepLinkProvider,
  MemoryCapacitorConfigProvider,
  MemoryDeepLinkProvider,
} from "../index.ts";

class App {
  home = $page({ path: "/", component: () => <p>home</p> });
  note = $page({
    path: "/notes/:id",
    schema: { params: z.object({ id: z.text() }) },
    loader: ({ params }: { params: { id: string } }) => ({ id: params.id }),
    component: (props: { id: string }) => <p>note {props.id}</p>,
  });
}

const boot = async (launch?: string, extra?: Service) => {
  const alepha = Alepha.create()
    .with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    })
    .with({ provide: DeepLinkProvider, use: MemoryDeepLinkProvider })
    .with(AlephaCapacitor)
    .with(AlephaReact)
    .with(App);
  if (extra) {
    alepha.with(extra);
  }
  alepha.inject(MemoryCapacitorConfigProvider).config = {
    appId: "dev.alepha.mobile",
    variant: "base",
    scheme: "mobile",
    mode: "bundled",
    env: {},
  };
  const links = alepha.inject(MemoryDeepLinkProvider);
  links.launch = launch;
  await act(async () => {
    await alepha.start();
  });
  await act(async () => {});
  return { alepha, links };
};

const text = () => document.getElementById("root")?.textContent;

describe("deep links in the app", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("opens a cold link before the first screen renders", async ({
    expect,
  }) => {
    await boot("mobile://app/notes/42?from=mail");

    expect(text()).toBe("note 42");
    expect(window.location.pathname).toBe("/notes/42");
    expect(window.location.search).toBe("?from=mail");
  });

  it("navigates on a warm link, once even when it is reported twice", async ({
    expect,
  }) => {
    const { links } = await boot();
    const length = window.history.length;

    await act(async () => {
      await links.open("mobile://app/notes/7");
      await links.open("mobile://app/notes/7");
    });

    expect(text()).toBe("note 7");
    expect(window.history.length).toBe(length + 1);
  });

  it("opens a link reported before the first screen once it is up", async ({
    expect,
  }) => {
    // What a cold start of a hydrated page sees: `appUrlOpen` arrives during
    // start, before the router has a state, and no launch resolver runs.
    class EarlyLink {
      protected readonly links = $inject(DeepLinkProvider);

      protected readonly onStart = $hook({
        on: "start",
        handler: async () => {
          await (this.links as MemoryDeepLinkProvider).open(
            "mobile://app/notes/9",
          );
        },
      });
    }

    await boot(undefined, EarlyLink);

    expect(text()).toBe("note 9");
    expect(window.location.pathname).toBe("/notes/9");
  });

  it("opens a launch link once even when it is also reported early", async ({
    expect,
  }) => {
    class EarlyLink {
      protected readonly links = $inject(DeepLinkProvider);

      protected readonly onStart = $hook({
        on: "start",
        handler: async () => {
          await (this.links as MemoryDeepLinkProvider).open(
            "mobile://app/notes/42",
          );
        },
      });
    }
    const length = window.history.length;

    await boot("mobile://app/notes/42", EarlyLink);

    expect(text()).toBe("note 42");
    expect(window.history.length).toBe(length);
  });

  it("does not navigate for a link that is not the app's", async ({
    expect,
  }) => {
    const { links } = await boot();

    await act(async () => {
      await links.open("other://app/notes/7");
    });

    expect(text()).toBe("home");
  });
});
