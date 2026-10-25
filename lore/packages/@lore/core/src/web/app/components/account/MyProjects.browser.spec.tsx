import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { projectFixture } from "../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../testing/virtualClientFake.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { I18n } from "../../services/I18n.ts";
import MyProjects from "./MyProjects.tsx";

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({});
  }
}

class Routes {
  project = $page({
    name: "project",
    path: "/:projectSlug",
    component: () => null,
  });
  projectCreate = $page({
    name: "projectCreate",
    path: "/new-project",
    component: () => null,
  });
}

const row = (id: number, title: string, archivedAt?: string) => ({
  ...projectFixture({ id, title, slug: title.toLowerCase() }),
  areaCount: 0,
  openQuestCount: 0,
  owner: true,
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  archivedAt,
});

/**
 * My projects is where an archived project stays (#Q2601), so it lists it
 * and says which with an Archived badge.
 */
describe("MyProjects", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  it("lists an archived project with an Archived badge", async ({ expect }) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(userProjectsAtom, {
      projects: [row(1, "Lore"), row(2, "Minorca", "2026-10-01T00:00:00.000Z")],
      totalCount: 2,
      ownedCount: 2,
      maxProjects: 10,
      canCreate: true,
    } as never);

    render(
      <AlephaContext.Provider value={alepha}>
        <MyProjects />
      </AlephaContext.Provider>,
    );

    const rows = await screen.findAllByTestId("account-project-row");
    expect(rows).toHaveLength(2);
    const badges = screen.getAllByTestId("account-project-archived");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("Archived");
    expect(
      rows
        .find((it) => it.textContent?.includes("Minorca"))
        ?.contains(badges[0]),
    ).toBe(true);
  });
});
