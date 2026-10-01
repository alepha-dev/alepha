import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { describe, expect, it } from "vitest";

import { Control } from "../Control.tsx";

/**
 * A text field reserves the right gutter only while its clear cross is drawn
 * (#Q2408). Reserved on every editable field, it took 36px from an empty
 * field's placeholder for a button that was not there.
 */
describe("Control clear gutter", () => {
  const Probe = () => {
    const form = useForm({
      schema: z.object({ search: z.text().optional() }),
      handler: () => {},
    });
    return (
      <Control input={form.input.search} placeholder="Search client, court" />
    );
  };

  const mount = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
    );
  };

  it("keeps the whole width for the text while there is nothing to clear", async () => {
    const { container } = await mount();
    const input = container.querySelector("input") as HTMLInputElement;

    expect(container.querySelector('[data-slot="control-clear"]')).toBeNull();
    expect(input.className).not.toMatch(/\bpr-9\b/);
  });

  it("reserves the gutter once the cross is drawn", async () => {
    const { container } = await mount();
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "cam" } });

    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="control-clear"]'),
      ).toBeTruthy(),
    );
    expect(input.className).toMatch(/\bpr-9\b/);
  });
});
