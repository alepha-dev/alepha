import { fireEvent, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { describe, expect, it } from "vitest";

import type { PaletteColor } from "@/api/schemas/paletteColorSchema.ts";

import { I18n } from "../../services/I18n.ts";
import KanbanColumnMenu from "./KanbanColumnMenu.tsx";

/**
 * The per-column menu the board grew with #1511: rename, recolour, delete,
 * without leaving the board for Settings.
 *
 * What is asserted here is the CONTRACT with the caller, because the caller
 * is what decides the two things this component must not decide for itself:
 * whether the column is editable at all (a synthesized lane is not) and
 * whether the viewer may manage columns (the endpoints are owner-only).
 */
describe("KanbanColumnMenu", () => {
  const mount = async (props: {
    color?: PaletteColor;
    onColor?: (color: PaletteColor | undefined) => void;
    onRename?: () => void;
    onDelete?: () => void;
  }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <KanbanColumnMenu
          name="In Progress"
          color={props.color}
          onRename={props.onRename ?? (() => {})}
          onColor={props.onColor ?? (() => {})}
          onDelete={props.onDelete ?? (() => {})}
        />
      </AlephaContext.Provider>,
    );
    fireEvent.click(view.getByTestId("kanban-column-menu"));
    return view;
  };

  it("offers rename, a colour for every palette token, and delete", async () => {
    const view = await mount({});

    expect(await view.findByTestId("kanban-column-rename")).toBeTruthy();
    expect(view.getByTestId("kanban-column-delete")).toBeTruthy();
    // Eight, matching `PALETTE_COLORS`. A picker that renders a subset is
    // how a token becomes unreachable without anything going red.
    expect(
      view.baseElement.querySelectorAll('[data-testid^="kanban-column-color-"]')
        .length,
    ).toBe(8);
  });

  it("names the column in the trigger, since a board has several", async () => {
    const view = await mount({});
    expect(
      view.getByTestId("kanban-column-menu").getAttribute("aria-label"),
    ).toContain("In Progress");
  });

  it("reports the chosen token", async () => {
    const picked: Array<PaletteColor | undefined> = [];
    const view = await mount({ onColor: (c) => picked.push(c) });

    fireEvent.click(await view.findByTestId("kanban-column-color-violet"));

    expect(picked).toEqual(["violet"]);
  });

  it("clears the colour when the current one is picked again", async () => {
    // The only way back to the board's derived tint without a separate
    // "default" entry in the list, so it has to keep working.
    const picked: Array<PaletteColor | undefined> = [];
    const view = await mount({
      color: "violet",
      onColor: (c) => picked.push(c),
    });

    fireEvent.click(await view.findByTestId("kanban-column-color-violet"));

    expect(picked).toEqual([undefined]);
  });

  it("marks the current colour as pressed", async () => {
    const view = await mount({ color: "amber" });

    expect(
      (await view.findByTestId("kanban-column-color-amber")).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      view
        .getByTestId("kanban-column-color-green")
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("does not delete on its own: the caller owns the confirmation", async () => {
    // `useKanbanColumnOps.remove` confirms before calling the endpoint, and
    // this component must not add a second prompt in front of it.
    const deletes: number[] = [];
    const view = await mount({ onDelete: () => deletes.push(1) });

    fireEvent.click(await view.findByTestId("kanban-column-delete"));

    expect(deletes).toEqual([1]);
  });
});
