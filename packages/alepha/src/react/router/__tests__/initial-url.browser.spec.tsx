import { Alepha, type Service, z } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { beforeEach, describe, it } from "vitest";

import { $page, ReactBrowserProvider, Redirection } from "../index.browser.ts";

class App {
  home = $page({ path: "/", component: () => <p>home</p> });
  note = $page({
    path: "/notes/:id",
    schema: { params: z.object({ id: z.text() }) },
    loader: ({ params }: { params: { id: string } }) => ({ id: params.id }),
    component: (props: { id: string }) => <p>note {props.id}</p>,
  });
  secret = $page({
    path: "/secret",
    loader: () => {
      throw new Redirection("/login");
    },
    component: () => <p>secret</p>,
  });
  login = $page({ path: "/login", component: () => <p>login</p> });
}

const boot = async (
  AppClass: Service,
  resolver?: () => Promise<string | undefined>,
) => {
  const alepha = Alepha.create().with(AlephaReact).with(AppClass);
  if (resolver) {
    alepha.inject(ReactBrowserProvider).initialUrlResolver = resolver;
  }
  await act(async () => {
    await alepha.start();
  });
  await act(async () => {});
  return alepha;
};

const text = () => document.getElementById("root")?.textContent;

describe("the first URL of a client-rendered boot", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("is the resolver's answer when there is one, query and hash kept", async ({
    expect,
  }) => {
    await boot(App, async () => "/notes/42?from=link#top");

    expect(text()).toBe("note 42");
    expect(window.location.pathname).toBe("/notes/42");
    expect(window.location.search).toBe("?from=link");
    expect(window.location.hash).toBe("#top");
  });

  it("is the page's own when the resolver answers nothing", async ({
    expect,
  }) => {
    window.history.replaceState({}, "", "/notes/7");

    await boot(App, async () => undefined);

    expect(text()).toBe("note 7");
    expect(window.location.pathname).toBe("/notes/7");
  });

  it("follows a redirect of the first screen into the address bar", async ({
    expect,
  }) => {
    // A cold link to a page that sends the visitor elsewhere used to show the
    // login screen under the refused URL.
    window.history.replaceState({}, "", "/secret");

    await boot(App);

    expect(text()).toBe("login");
    expect(window.location.pathname).toBe("/login");
  });
});
