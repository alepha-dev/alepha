import { renderHook } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { useNavBreadcrumbs } from "../useNavBreadcrumbs.ts";

describe("useNavBreadcrumbs", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  /**
   * A crumb links to the URL its layer was rendered at, not to its route's
   * pattern: under `/projects/:id/settings`, the parent crumb is
   * `/projects/65`, never `/projects/:id`.
   */
  it("links a parameterised parent crumb to its compiled path", async () => {
    alepha = Alepha.create().with(AlephaReactRouter).with(AlephaReactI18n);
    await alepha.start();

    const route = (name: string, match: string, label: string) =>
      ({ name, match, label }) as any;
    const state = alepha.store.get("alepha.react.router.state");
    alepha.store.set("alepha.react.router.state", {
      ...state,
      layers: [
        {
          name: "shell",
          index: 1,
          path: "/",
          element: null,
          route: route("shell", "/", "Home"),
        },
        {
          name: "project",
          index: 2,
          path: "/projects/65",
          element: null,
          route: route("project", "/projects/:id", "Project"),
        },
        {
          name: "projectSettings",
          index: 3,
          path: "/projects/65/settings",
          element: null,
          route: route("projectSettings", "/projects/:id/settings", "Settings"),
        },
      ],
    } as any);

    const app = alepha;
    const { result } = renderHook(() => useNavBreadcrumbs({ root: "shell" }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AlephaContext.Provider value={app}>{children}</AlephaContext.Provider>
      ),
    });

    expect(result.current).toEqual([
      { label: "Home", href: "/" },
      { label: "Project", href: "/projects/65" },
      { label: "Settings" },
    ]);
  });
});
