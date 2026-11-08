import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import {
  FormValidationError,
  type FormModel,
  useForm,
} from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import { AutoForm } from "../AutoForm.tsx";
import { Control } from "../Control.tsx";

/**
 * Every `Control*` variant shows its field's entry of `FormModel.errors`, and
 * `AutoForm` brings the first one into view after a refused submit, opening
 * a collapsed object to reach it (#Q3204).
 */
describe("field errors across the Control variants", () => {
  const schema = z.object({
    title: z.text(),
    count: z.integer(),
    color: z.enum(["red", "blue"]),
    due: z.date(),
    secret: z.text().meta({ format: "password" }),
    address: z.object({ city: z.text() }),
    items: z.array(z.object({ name: z.text() })),
  });

  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const setup = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const messages = {
    "/title": "Bad title",
    "/count": "Bad count",
    "/color": "Bad color",
    "/due": "Bad date",
    "/secret": "Bad secret",
    "/address/city": "Bad city",
    "/items/0/name": "Bad row",
  };

  it("shows every variant's error at once", async ({ expect }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    const Probe = (props: { onForm: (form: any) => void }) => {
      const form = useForm({
        id: "c",
        schema,
        initialValues: { address: { city: "" }, items: [{ name: "" }] },
        handler: () => {},
      });
      props.onForm(form);
      return (
        <form {...form.props}>
          <Control input={form.input.title} label="Title" />
          <Control input={form.input.count} label="Count" />
          <Control input={form.input.color} label="Color" />
          <Control input={form.input.due} label="Due" />
          <Control input={form.input.secret} label="Secret" password />
          <Control input={form.input.address} label="Address" />
          <Control input={form.input.items} label="Items" />
        </form>
      );
    };
    const ui = mount(alepha, <Probe onForm={(f) => (model = f)} />);

    act(() => {
      model!.setErrors(
        Object.entries(messages).map(([path, message]) => ({ path, message })),
      );
    });

    await waitFor(() => {
      for (const message of Object.values(messages)) {
        expect(ui.getByText(message)).toBeTruthy();
      }
    });

    await alepha.stop();
  });

  it("brings the first error into view, opening a collapsed object for it", async ({
    expect,
  }) => {
    const alepha = await setup();
    const formSchema = z.object({
      address: z.object({ city: z.text().optional() }),
      title: z.text().optional(),
    });
    const Probe = () => {
      const form = useForm({
        id: "a",
        schema: formSchema,
        initialValues: { address: { city: "" } },
        handler: () => {
          throw new FormValidationError({
            message: "Unknown city",
            path: "/address/city",
            issues: [{ path: "/address/city", message: "Unknown city" }],
          });
        },
      });
      return <AutoForm form={form} />;
    };
    const ui = mount(alepha, <Probe />);

    fireEvent.click(ui.getByRole("button", { name: "Collapse" }));
    expect(document.getElementById("a-address.city")).toBeNull();

    fireEvent.submit(document.getElementById("a")!);

    await waitFor(() => {
      const city = document.getElementById("a-address.city");
      expect(city?.getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(city);
    });
    expect(ui.getByText("Unknown city")).toBeTruthy();

    await alepha.stop();
  });
});
