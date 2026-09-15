import { render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import { virtualClientFake } from "@/testing/virtualClientFake.ts";

import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectEpicAside from "./ProjectEpicAside.tsx";

/**
 * Nothing here writes, so the client is never reached; the seam exists so
 * the release control's `useClient` has something to hand out.
 */
class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({});
  }
}

const title =
  "Static files carry the app's headers on every host, the compiled binary included";

const anEpic = {
  id: 1,
  projectId: 1,
  number: 49,
  title,
  status: "completed",
  createdAt: "2026-09-10T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
  progress: { completed: 6, inProgress: 0, shelved: 0, total: 6 },
} as unknown as EpicResource;

/**
 * Feedback #P2205 (#Q2352): the aside's reference row reads ID, a Name row
 * follows it, and the panel has no heading. The heading truncated a long
 * title to one line; a row's value wraps.
 */
describe("ProjectEpicAside", () => {
  const mount = async (lang: "en" | "fr") => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);
    alepha.store.set(currentReleasesAtom, []);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectEpicAside epic={anEpic} quests={null} onChange={() => {}} />
      </AlephaContext.Provider>,
    );
    await screen.findByText("#E49");
    return { alepha, view };
  };

  it("opens on the ID, then the name in full", async ({ expect }) => {
    const { alepha, view } = await mount("en");

    const labels = [...view.container.querySelectorAll("dt")].map(
      (dt) => dt.textContent,
    );
    expect(labels.slice(0, 3)).toEqual(["ID", "Name", "Status"]);
    const values = view.container.querySelectorAll("dd");
    expect(values[0].textContent).toContain("#E49");
    expect(values[1].textContent).toBe(title);

    await alepha.stop();
  });

  it("draws no heading above the list", async ({ expect }) => {
    const { alepha, view } = await mount("en");

    // The name appears once, in its row, and nothing carries it as a
    // tooltip, which is what the truncated heading did.
    expect(screen.getAllByText(title)).toHaveLength(1);
    expect(view.container.querySelector(`[title="${title}"]`)).toBeNull();
    expect(view.container.firstElementChild?.firstElementChild?.tagName).toBe(
      "DL",
    );

    await alepha.stop();
  });

  it("labels the two rows in French too", async ({ expect }) => {
    const { alepha, view } = await mount("fr");

    const labels = [...view.container.querySelectorAll("dt")].map(
      (dt) => dt.textContent,
    );
    expect(labels.slice(0, 2)).toEqual(["ID", "Nom"]);

    await alepha.stop();
  });
});
