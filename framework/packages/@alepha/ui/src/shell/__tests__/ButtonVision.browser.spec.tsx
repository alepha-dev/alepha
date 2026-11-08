import { act, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactUi, ColorScheme, uiAtom } from "alepha/react/ui";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ButtonVision, type ButtonVisionProps } from "../ButtonVision.tsx";

/**
 * `ButtonVision` flips the vision mode, and with `ColorScheme` mounted the
 * `cvd` class on `<html>` follows. Both icons are in the markup whatever the
 * state, so a prerendered page and the visitor's render agree.
 */
describe("ButtonVision", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-vision");
  });

  const mount = async (props: ButtonVisionProps = {}) => {
    alepha = Alepha.create().with(AlephaReactUi);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <ColorScheme />
        <ButtonVision {...props} />
      </AlephaContext.Provider>,
    );
  };

  it("toggles the vision mode and the cvd class, reporting it in aria-pressed", async () => {
    await mount();
    const button = screen.getByLabelText("Colour-blind mode");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    await act(async () => fireEvent.click(button));

    expect(alepha!.store.get(uiAtom).vision).toBe("cvd");
    expect(document.documentElement.classList.contains("cvd")).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await act(async () => fireEvent.click(button));

    expect(alepha!.store.get(uiAtom).vision).toBe("normal");
    expect(document.documentElement.classList.contains("cvd")).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders both icons whatever the state, for CSS to reveal one", async () => {
    await mount();
    const button = screen.getByLabelText("Colour-blind mode");
    expect(button.querySelectorAll("svg").length).toBe(2);

    await act(async () => fireEvent.click(button));

    expect(button.querySelectorAll("svg").length).toBe(2);
  });

  it("takes its label from props", async () => {
    await mount({ label: "Mode daltonien", variant: "outlined" });

    expect(screen.getByLabelText("Mode daltonien")).toBeTruthy();
  });
});
