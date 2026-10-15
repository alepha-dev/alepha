import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { Personal, useStore } from "alepha/react";
import { $page, AlephaReactRouter, NestedView } from "alepha/react/router";
import { $issuer, AlephaSecurity, currentUserAtom } from "alepha/security";
import { ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaReactAuth } from "../index.ts";

/**
 * `<Personal>` (#E78): the personal part of a shared page renders its
 * fallback on the server, so a layout with a user menu no longer makes
 * every page personal.
 */
describe("<Personal>", () => {
  const PRIVATE =
    /<script id="__ssr_private" type="application\/json">(.*?)<\/script>/;

  const UserBadge = () => {
    const [user] = useStore(currentUserAtom);
    return <b>user:{user?.id ?? "anonymous"}</b>;
  };

  const Layout = () => (
    <div>
      <header>
        <Personal fallback={<i>slot</i>}>
          <UserBadge />
        </Personal>
      </header>
      <NestedView />
    </div>
  );

  const boot = async () => {
    class App {
      realm = $issuer({
        secret: "personal-secret",
        roles: [{ name: "user", permissions: [{ name: "*" }] }],
      });

      layout = $page({
        component: Layout,
        children: () => [this.home, this.mine],
      });

      home = $page({ path: "/", component: () => "shared content" });

      // Personal before the render: its loader reads the visitor.
      mine = $page({
        path: "/mine",
        loader: (ctx: any) => ({ greeting: `hi ${ctx.user?.id}` }),
        component: (props: { greeting: string }) => props.greeting,
      });
    }

    const alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaSecurity)
      .with(AlephaReactAuth)
      .with(App);
    const app = alepha.inject(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;
    const id = randomUUID();
    const { access_token } = await app.realm.createToken({
      id,
      roles: ["user"],
    });

    const visit = async (path: string, signedIn = true) => {
      const res = await fetch(`${base}${path}`, {
        headers: signedIn ? { authorization: `Bearer ${access_token}` } : {},
      });
      const body = await res.text();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const own = body.match(PRIVATE);
      return {
        body,
        cache: res.headers.get("x-alepha-cache") ?? "",
        own: own ? JSON.parse(own[1]) : {},
      };
    };

    return { visit, id };
  };

  it("keeps a page with a user menu shared: the fallback goes in the HTML", async ({
    expect,
  }) => {
    const { visit, id } = await boot();

    const first = await visit("/");
    const second = await visit("/", false);

    expect(first.body).toContain("<i>slot</i>");
    expect(first.body).not.toContain(`<!-- -->${id}`);
    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit; verdict=shared");
    // The visitor's state is in their private script, for the browser to
    // render the menu after hydration.
    expect(first.own["alepha.security.user"].id).toBe(id);
    expect(first.own).not.toHaveProperty("alepha.react.personal.rendered");
  });

  it("renders the children on a page that is personal anyway", async ({
    expect,
  }) => {
    const { visit, id } = await boot();

    const { body, own } = await visit("/mine");

    expect(body).toContain(`user:<!-- -->${id}`);
    expect(body).not.toContain("<i>slot</i>");
    expect(own["alepha.react.personal.rendered"]).toBe(true);
  });
});
