import { I18n } from "@lore/core/web";
import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, expect, it } from "vitest";

import { projectDirectoriesAtom } from "../../../atoms/projectDirectoriesAtom.ts";
import { userFoliosAtom } from "../../../atoms/userFoliosAtom.ts";
// Imported at the top: the shell registers it as a lazy chunk.
import FolioCardFilterEditor from "./FolioCardFilterEditor.tsx";

const DIR = "11111111-1111-4111-8111-111111111111";

const folio = (
  shortId: number,
  title: string,
  extra: {
    type?: "text" | "table";
    protected?: boolean;
    directoryId?: string;
  } = {},
) => ({
  id: `2222222${shortId}-2222-4222-8222-222222222222`,
  shortId,
  projectId: 1,
  title,
  summary: "",
  type: extra.type ?? ("text" as const),
  protected: extra.protected ?? false,
  pinned: false,
  directoryId: extra.directoryId,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});

/**
 * The Folio card's filter step (#Q3520).
 */
describe("FolioCardFilterEditor", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (values: Record<string, unknown>) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(projectDirectoriesAtom, [
      { id: DIR, shortId: 1, name: "plans" },
    ]);
    alepha.store.set(userFoliosAtom, [
      folio(1, "Notes"),
      folio(2, "Goals", { type: "table", directoryId: DIR }),
      folio(3, "Secrets", { protected: true }),
    ]);
    const changes: Array<Record<string, unknown>> = [];
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <FolioCardFilterEditor
          values={values}
          projectId={1}
          onChange={(next) => changes.push(next)}
        />
      </AlephaContext.Provider>,
    );
    return { changes, view };
  };

  const options = () =>
    screen.getAllByTestId("dashboard-folio-option").map((it) => it.textContent);

  it("lists the project's folios with their path, never an encrypted one", async () => {
    await mount({ folio: 0, show: "auto" });
    expect(options()).toEqual(["Notes", "Goalsplans"]);
  });

  it("searches by title and path", async () => {
    await mount({ folio: 0, show: "auto" });
    fireEvent.change(screen.getByLabelText("Find a folio"), {
      target: { value: "plans" },
    });
    expect(options()).toEqual(["Goalsplans"]);
  });

  it("picks a folio, and offers the Show choices that fit it", async () => {
    const { changes } = await mount({ folio: 2, show: "auto" });
    expect(
      screen
        .getAllByTestId("dashboard-filter-option")
        .map((it) => it.textContent),
    ).toEqual(["What fits", "First rows", "What comes next"]);
    fireEvent.click(screen.getByText("Notes"));
    expect(changes.at(-1)).toEqual({ folio: 1, show: "auto" });
  });

  it("offers a text folio's own choices", async () => {
    await mount({ folio: 1, show: "auto" });
    expect(
      screen
        .getAllByTestId("dashboard-filter-option")
        .map((it) => it.textContent),
    ).toEqual(["What fits", "The text"]);
  });
});
