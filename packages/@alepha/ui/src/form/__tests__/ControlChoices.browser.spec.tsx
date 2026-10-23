import { fireEvent, render, screen } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import { Control } from "../Control.tsx";

/**
 * The field shapes MCS reached for and the kit did not have (#Q2760):
 *
 * - a boolean switch draws no required marker: it always holds a value;
 * - `checkboxes` renders a multi-choice as one checkbox per option, every
 *   option visible, the value an array in the options' order;
 * - `month` is a month picker whose value is `YYYY-MM`;
 * - `accept` reaches the file input.
 */
describe("Control choices", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  const mount = async (ui: ReactNode) => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  it("draws no required marker on a boolean switch", async () => {
    const Probe = () => {
      const form = useForm({
        schema: z.object({ mine: z.boolean() }),
        initialValues: { mine: false },
        handler: () => {},
      });
      return <Control input={form.input.mine} label="Mine" />;
    };
    const ui = await mount(<Probe />);

    expect(ui.container.textContent).not.toContain("*");
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("renders a multi-choice as checkboxes, kept in the options' order", async () => {
    let seen: unknown;
    const Probe = () => {
      const form = useForm({
        schema: z.object({ days: z.array(z.text()).optional() }),
        handler: () => {},
        onChange: (_key, value) => {
          seen = value;
        },
      });
      return (
        <Control
          input={form.input.days}
          label="Days"
          checkboxes
          items={[
            { value: "mon", label: "Monday" },
            { value: "tue", label: "Tuesday" },
            { value: "wed", label: "Wednesday" },
          ]}
        />
      );
    };
    await mount(<Probe />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: "Wednesday" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Monday" }));
    expect(seen).toEqual(["mon", "wed"]);
    expect(
      screen
        .getByRole("checkbox", { name: "Monday" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("picks a month as YYYY-MM", async () => {
    let seen: unknown;
    const Probe = () => {
      const form = useForm({
        schema: z.object({ period: z.text().optional() }),
        initialValues: { period: "2026-03" },
        handler: () => {},
        onChange: (_key, value) => {
          seen = value;
        },
      });
      return (
        <Control
          input={form.input.period}
          label="Period"
          month
          inputProps={{ "aria-label": "Report month" }}
        />
      );
    };
    const ui = await mount(<Probe />);

    const trigger = screen.getByRole("button", { name: "Report month" });
    fireEvent.click(trigger);
    const may = ui.baseElement.querySelector('[data-value="2026-05"]');
    expect(may).toBeTruthy();
    fireEvent.click(may!);
    expect(seen).toBe("2026-05");
  });

  it("passes accept to the file input", async () => {
    const Probe = () => {
      const form = useForm({
        schema: z.object({ file: z.any().optional() }),
        handler: () => {},
      });
      return <Control input={form.input.file} label="CSV" file accept=".csv" />;
    };
    const ui = await mount(<Probe />);

    expect(
      ui.container.querySelector('input[type="file"]')?.getAttribute("accept"),
    ).toBe(".csv");
  });
});
