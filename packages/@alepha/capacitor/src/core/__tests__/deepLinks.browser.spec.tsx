import { Alepha, z } from "alepha";
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

const boot = async (launch?: string) => {
  const alepha = Alepha.create()
    .with({
      provide: CapacitorConfigProvider,
      use: MemoryCapacitorConfigProvider,
    })
    .with({ provide: DeepLinkProvider, use: MemoryDeepLinkProvider })
    .with(AlephaCapacitor)
    .with(AlephaReact)
    .with(App);
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
