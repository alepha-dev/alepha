import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { afterEach, describe, expect, it } from "vitest";

import { RunFooter } from "../analytics/RunFooter.tsx";

/**
 * The analytics "More" menu is hand-built on a plain `div`, so the contract
 * its `role="menu"` claims is the kit's own to keep (#Q3339): focus into the
 * menu on open, arrows, Home and End between items, Escape back to the
 * trigger.
 */
describe("RunFooter menu keyboard", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <RunFooter
          running={false}
          onRun={() => {}}
          onRequest={() => {}}
          onReset={() => {}}
        />
      </AlephaContext.Provider>,
    );
    return screen.getByRole("button", { name: "More" });
  };

  const press = (key: string) =>
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key });
    });

  it("moves the focus into the menu when it opens", async () => {
    const trigger = await mount();
    act(() => {
      fireEvent.click(trigger);
    });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: /Request/ }),
    );
  });

  it("moves between items with the arrows, Home and End", async () => {
    const trigger = await mount();
    act(() => {
      fireEvent.click(trigger);
    });
    const [request, reset] = screen.getAllByRole("menuitem");
    press("ArrowDown");
    expect(document.activeElement).toBe(reset);
    press("ArrowDown");
    expect(document.activeElement).toBe(request);
    press("ArrowUp");
    expect(document.activeElement).toBe(reset);
    press("Home");
    expect(document.activeElement).toBe(request);
    press("End");
    expect(document.activeElement).toBe(reset);
  });

  it("closes on Escape and gives the focus back to the trigger", async () => {
    const trigger = await mount();
    act(() => {
      fireEvent.click(trigger);
    });
    press("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
