import { randomUUID } from "node:crypto";

import { $hook, $inject, Alepha, type ReadRecorder, z } from "alepha";
import { useStore } from "alepha/react";
import { AlephaReactI18n, langAtom } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import {
  $issuer,
  $secure,
  AlephaSecurity,
  currentUserAtom,
} from "alepha/security";
import { $action, ServerProvider } from "alepha/server";
import { $cookie } from "alepha/server/cookies";
import { $client, AlephaServerLinks } from "alepha/server/links";
import { describe, it } from "vitest";

import { AlephaReactAuth } from "../index.ts";

/**
 * Read tracking (#E78): the framework records what a page render reads and
 * rules the page shared, variant or personal. These pin one verdict per
 * channel the tracker watches.
 */
describe("read tracking", () => {
  /**
   * Keeps the recorder of the last page request, so a streamed page's
   * verdict can be read once its body has been consumed.
   */
  class LastRecorder {
    protected readonly alepha = $inject(Alepha);
    public last?: ReadRecorder;

    protected readonly onBegin = $hook({
      on: "react:server:render:begin",
      handler: ({ request }) => {
        // The page cache's anonymous re-render runs without a recorder.
        const recorder = this.alepha.store.recorder();
        if (request && recorder) {
          this.last = recorder;
        }
      },
    });
  }

  class Api {
    hello = $action({
      path: "/hello",
      method: "GET",
      schema: { response: z.text() },
      handler: () => "hello",
    });
  }

  class Remote {
    whoami = $action({
      path: "/whoami",
      method: "GET",
      schema: { response: z.text() },
      handler: () => "remote",
    });
  }

  const UserBadge = () => {
    const [user] = useStore(currentUserAtom);
    return <span>{user?.id ?? "anonymous"}</span>;
  };

  const LangBadge = () => {
    const [lang] = useStore(langAtom);
    return <span>{lang}</span>;
  };

  const boot = async (remoteHost?: string, i18n = true) => {
    class App {
      realm = $issuer({
        secret: "read-tracking-secret",
        roles: [{ name: "user", permissions: [{ name: "*" }] }],
      });

      api = $client<Api>();
      remote = $client<Remote>({ hostname: remoteHost ?? "http://unused" });

      theme = $cookie({ name: "theme", schema: z.text() });

      home = $page({ path: "/", component: () => "plain" });

      translated = $page({ path: "/translated", component: LangBadge });

      withUser = $page({ path: "/with-user", component: UserBadge });

      guarded = $page({
        path: "/guarded",
        use: [$secure()],
        component: () => "secret",
      });

      publicLoader = $page({
        path: "/public-loader",
        loader: async () => ({ text: await this.api.hello() }),
        component: (props: { text: string }) => props.text,
      });

      userLoader = $page({
        path: "/user-loader",
        loader: (ctx: any) => ({ id: ctx.user?.id }),
        component: (props: { id?: string }) => props.id ?? "none",
      });

      cookieLoader = $page({
        path: "/cookie-loader",
        loader: () => ({ theme: this.theme.get() ?? "none" }),
        component: (props: { theme: string }) => props.theme,
      });

      remoteLoader = $page({
        path: "/remote-loader",
        loader: async () => ({ text: await this.remote.whoami() }),
        component: (props: { text: string }) => props.text,
      });

      writesUser = $page({
        path: "/writes-user",
        loader: () => {
          this.alepha.store.set(currentUserAtom, {
            id: "someone",
            roles: [],
          });
          return {};
        },
        component: () => "wrote",
      });

      setsCookie = $page({
        path: "/sets-cookie",
        loader: () => {
          this.theme.set("dark");
          return {};
        },
        component: () => "set",
      });

      protected readonly alepha = $inject(Alepha);

      bufferedUser = $page({
        path: "/buffered-user",
        stream: false,
        component: UserBadge,
      });
    }

    const alepha = Alepha.create().with(AlephaReactRouter);
    if (i18n) {
      alepha.with(AlephaReactI18n);
    }
    alepha
      .with(AlephaSecurity)
      .with(AlephaServerLinks)
      .with(AlephaReactAuth)
      .with(LastRecorder)
      .with(Api)
      .with(App);
    const app = alepha.inject(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;
    const { access_token } = await app.realm.createToken({
      id: randomUUID(),
      roles: ["user"],
    });

    const visit = async (path: string, signedIn = false) => {
      const res = await fetch(`${base}${path}`, {
        headers: signedIn ? { authorization: `Bearer ${access_token}` } : {},
      });
      const body = await res.text();
      const recorder = alepha.inject(LastRecorder).last!;
      return { res, body, recorder };
    };

    return { visit };
  };

  it("rules a page that reads nothing personal shared, signed in or not", async ({
    expect,
  }) => {
    const { visit } = await boot(undefined, false);

    expect((await visit("/")).recorder.verdict()).toBe("shared");
    expect((await visit("/", true)).recorder.verdict()).toBe("shared");
  });

  it("rules a page that reads only the language variant", async ({
    expect,
  }) => {
    const { visit } = await boot();

    expect((await visit("/translated", true)).recorder.verdict()).toBe(
      "variant",
    );
    // With i18n installed every page reads the language (`<html lang>` is
    // in the body), so a page with nothing personal is variant, never shared.
    expect((await visit("/", true)).recorder.verdict()).toBe("variant");
  });

  it("rules a page whose markup reads the user personal", async ({
    expect,
  }) => {
    const { visit } = await boot();

    const { recorder, body } = await visit("/with-user", true);

    expect(body).not.toContain("anonymous");
    expect(recorder.verdict()).toBe("personal");
    expect(recorder.describe()).toBe("atom:alepha.security.user");
  });

  it("rules an anonymous visitor's render of the same page personal too", async ({
    expect,
  }) => {
    // The read is what counts, not its value: the markup depends on it.
    const { visit } = await boot();

    expect((await visit("/with-user")).recorder.verdict()).toBe("personal");
  });

  it("rules a $secure page personal, because its guard reads the user", async ({
    expect,
  }) => {
    const { visit } = await boot();

    const { recorder, res } = await visit("/guarded", true);

    expect(res.status).toBe(200);
    expect(recorder.verdict()).toBe("personal");
  });

  it("keeps a signed-in loader that calls a public in-process action shared", async ({
    expect,
  }) => {
    const { visit } = await boot(undefined, false);

    const { recorder, body } = await visit("/public-loader", true);

    expect(body).toContain("hello");
    expect(recorder.verdict()).toBe("shared");
  });

  it("rules a loader that reads state.user personal", async ({ expect }) => {
    const { visit } = await boot();

    const { recorder } = await visit("/user-loader", true);

    expect(recorder.verdict()).toBe("personal");
    expect(recorder.describe()).toBe("user:state.user");
  });

  it("rules a loader that reads a cookie personal", async ({ expect }) => {
    const { visit } = await boot();

    const { recorder } = await visit("/cookie-loader");

    expect(recorder.verdict()).toBe("personal");
    expect(recorder.describe()).toBe("cookie:theme");
  });

  it("rules a remote call carrying the visitor's credential personal, and one without shared", async ({
    expect,
  }) => {
    const remote = Alepha.create().with(AlephaServerLinks).with(Remote);
    await remote.start();
    const { visit } = await boot(remote.inject(ServerProvider).hostname, false);

    const signedIn = await visit("/remote-loader", true);
    expect(signedIn.body).toContain("remote");
    expect(signedIn.recorder.verdict()).toBe("personal");
    expect(signedIn.recorder.describe()).toBe("remote:whoami");

    const anonymous = await visit("/remote-loader");
    expect(anonymous.recorder.verdict()).toBe("shared");

    await remote.stop();
  });

  it("rules a render that writes a personal atom personal", async ({
    expect,
  }) => {
    // A hit builds the private script without rendering: a write during the
    // render would be missing from it.
    const { visit } = await boot(undefined, false);

    const { recorder } = await visit("/writes-user");

    expect(recorder.verdict()).toBe("personal");
    expect(recorder.describe()).toBe("write:alepha.security.user");
  });

  it("does not count the framework's own write of the user before the render", async ({
    expect,
  }) => {
    // `ReactAuthProvider` writes `currentUserAtom` in `render:begin`, which
    // a hit runs again: a signed-in visit to a plain page stays shared.
    const { visit } = await boot(undefined, false);

    expect((await visit("/", true)).recorder.verdict()).toBe("shared");
  });

  it("rules a render that sets a cookie personal", async ({ expect }) => {
    const { visit } = await boot(undefined, false);

    const { recorder, res } = await visit("/sets-cookie");

    expect(res.headers.get("set-cookie")).toContain("theme");
    expect(recorder.verdict()).toBe("personal");
    expect(recorder.describe()).toBe("set-cookie:theme");
  });

  it("names the verdict and the first personal read in the dev header of a buffered page", async ({
    expect,
  }) => {
    const { visit } = await boot();

    const { res } = await visit("/buffered-user", true);

    expect(res.headers.get("x-alepha-cache")).toBe(
      "miss; verdict=personal; read=atom:alepha.security.user",
    );
  });

  it("says only miss on a streamed page, whose verdict comes after the headers", async ({
    expect,
  }) => {
    const { visit } = await boot();

    const { res } = await visit("/", true);

    expect(res.headers.get("x-alepha-cache")).toBe("miss");
  });
});
