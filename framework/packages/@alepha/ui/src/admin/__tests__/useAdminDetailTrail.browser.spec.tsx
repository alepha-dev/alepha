import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactHead } from "alepha/react/head";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { navCrumbsAtom } from "../../shell/navCrumbsAtom.ts";
import { useAdminDetailTrail } from "../useAdminDetailTrail.ts";

/**
 * A detail page's trail (#Q3798): `Admin > Jobs > uptime.tick`, the list
 * crumb linking back, and the same trail in the tab title.
 */
describe("useAdminDetailTrail", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const Job = (props: { name?: string }) => {
    useAdminDetailTrail(
      "jobDetail",
      { label: "Jobs", href: "/admin/jobs" },
      props.name,
    );
    return null;
  };

  const mount = async (name?: string) => {
    alepha = Alepha.create().with(AlephaReactHead).with(AlephaReactI18n);
    await alepha.start();
    document.title = "Admin - Job";
    await act(async () => {
      render(
        <AlephaContext.Provider value={alepha}>
          <Job name={name} />
        </AlephaContext.Provider>,
      );
    });
    return alepha;
  };

  it("names the list and the record in the crumbs and the title", async () => {
    const app = await mount("uptime.tick");

    expect(app.store.get(navCrumbsAtom)).toEqual({
      route: "jobDetail",
      crumbs: [
        { label: "Jobs", href: "/admin/jobs" },
        { label: "uptime.tick" },
      ],
    });
    expect(document.title).toBe("Admin - Jobs - uptime.tick");
  });

  it("leaves the route's own crumb and title while the record loads", async () => {
    const app = await mount(undefined);

    expect(app.store.get(navCrumbsAtom)?.route ?? "").toBe("");
    expect(document.title).toBe("Admin - Job");
  });
});
