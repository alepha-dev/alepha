import { Alepha } from "alepha";
import {
  $page,
  AlephaReactRouter,
  ReactPageProvider,
} from "alepha/react/router";
import { $action } from "alepha/server";
import { AlephaServerLinks, LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { BuildTables } from "../services/BuildTables.ts";

/**
 * A server builds its links, its router trie and its page tree on the first
 * fetch (#Q3396). `alepha build` never starts the app, so it builds them
 * itself: an error they raise fails the build, not the first request.
 */
describe("BuildTables", () => {
  it("fails on a duplicate action name, in a container that never started", ({
    expect,
  }) => {
    class Twice {
      a = $action({
        method: "GET",
        path: "/a",
        name: "same",
        handler: () => "",
      });
      b = $action({
        method: "GET",
        path: "/b",
        name: "same",
        handler: () => "",
      });
    }
    const alepha = Alepha.create().with(AlephaServerLinks).with(Twice);
    expect(() => alepha.inject(BuildTables).force(alepha)).toThrow(
      /Duplicate action name "same"/,
    );
  });

  it("builds the links and the page tree of a sound app, once", ({
    expect,
  }) => {
    class App {
      ping = $action({ method: "GET", path: "/ping", handler: () => "" });
      home = $page({ path: "/", component: () => "home" });
    }
    const alepha = Alepha.create()
      .with(AlephaServerLinks)
      .with(AlephaReactRouter)
      .with(App);
    const tables = alepha.inject(BuildTables);
    tables.force(alepha);
    tables.force(alepha);

    expect(
      alepha
        .inject(LinkProvider)
        .getServerLinks()
        .map((it) => it.name),
    ).toContain("ping");
    expect(
      alepha
        .inject(ReactPageProvider)
        .getPages()
        .map((it) => it.name),
    ).toContain("home");
  });
});
