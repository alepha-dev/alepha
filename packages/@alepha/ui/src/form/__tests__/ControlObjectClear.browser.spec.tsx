import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { type BaseInputField, useFieldValue, useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ControlObject } from "../control-object.tsx";

/**
 * The clear button used to be behind an opt-in `clearable` prop that the only
 * thing mounting this component - `Control` - never passed, so an initialised
 * optional object could be created from the UI and then never removed.
 *
 * The schema answers it now: optional means clearable, and a caller opts out.
 */
describe("ControlObject clear", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  /**
   * Renders the bound value, so the assertions read form state rather than
   * whether some child input happens to be on screen.
   */
  const Reporter = (props: { input: BaseInputField }) => {
    const [value] = useFieldValue(props.input);
    return (
      <span data-testid="value">
        {value === undefined ? "∅" : JSON.stringify(value)}
      </span>
    );
  };

  const Probe = (props: { required?: boolean; clearable?: boolean }) => {
    const address = z.object({ city: z.text().optional() as never });
    const form = useForm({
      schema: z.object(
        props.required ? { address } : { address: address.optional() as never },
      ),
      handler: () => {},
    });
    return (
      <>
        <ControlObject
          input={form.input.address}
          label="Address"
          clearable={props.clearable}
        />
        <Reporter input={form.input.address} />
      </>
    );
  };

  const initialize = async (ui: ReturnType<typeof render>) => {
    fireEvent.click(await ui.findByRole("button", { name: "Initialize" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).not.toBe("∅");
    });
  };

  it("clears an initialised optional object, with no prop passed", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    await initialize(ui);

    fireEvent.click(await ui.findByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("∅");
    });
  });

  it("offers no clear button on a required object", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe required />);

    await initialize(ui);

    expect(ui.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("lets a caller opt out with clearable={false}", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe clearable={false} />);

    await initialize(ui);

    expect(ui.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
