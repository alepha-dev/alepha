import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import {
  FormValidationError,
  type FormModel,
  useForm,
  useFormState,
} from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { type ReactNode, useState } from "react";
import { describe, it } from "vitest";

import { Control } from "../Control.tsx";

/**
 * Field errors live on `FormModel.errors` (#Q3200): every issue of a schema
 * failure lands on its field, through `Control` and with no change of its
 * own, nested and array-row paths included, and a field mounted after the
 * failure still shows it.
 */
describe("Control and FormModel.errors", () => {
  const schema = z.object({
    title: z.text({ minLength: 2 }),
    email: z.email(),
    address: z.object({ city: z.text().optional() }),
    items: z.array(z.object({ name: z.text().optional() })),
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

  const invalid = (id: string) =>
    document.getElementById(id)?.getAttribute("aria-invalid") === "true";

  const messageOf = (id: string) =>
    (document.getElementById(id)?.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((ref) => document.getElementById(ref)?.textContent ?? "")
      .join(" ");

  interface ProbeProps {
    refuse?: FormValidationError;
    onForm?: (form: FormModel<typeof schema>) => void;
  }

  const Probe = (props: ProbeProps) => {
    const [showCity, setShowCity] = useState(false);
    const form = useForm({
      id: "f",
      schema,
      initialValues: {
        title: "tt",
        email: "a@example.com",
        address: { city: "" },
        items: [{ name: "a" }, { name: "b" }],
      },
      handler: () => {
        if (props.refuse) throw props.refuse;
      },
    });
    props.onForm?.(form);
    const formState = useFormState(form, ["error"]);
    return (
      <form {...form.props} data-testid="form">
        <Control input={form.input.title} label="Title" />
        <Control input={form.input.email} label="Email" />
        <Control input={form.input.items} label="Items" />
        {showCity && (
          <Control input={form.input.address.items.city} label="City" />
        )}
        <button type="button" onClick={() => setShowCity(true)}>
          show city
        </button>
        <span data-testid="form-error">{formState.error?.message ?? ""}</span>
      </form>
    );
  };

  it("shows every issue of one failed submit at once", async ({ expect }) => {
    const alepha = await setup();
    const ui = mount(alepha, <Probe />);

    fireEvent.change(document.getElementById("f-title")!, {
      target: { value: "x" },
    });
    fireEvent.change(document.getElementById("f-email")!, {
      target: { value: "not-an-email" },
    });
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(invalid("f-title")).toBe(true);
      expect(invalid("f-email")).toBe(true);
    });
    expect(messageOf("f-title")).not.toBe("");
    expect(messageOf("f-email")).not.toBe("");

    await alepha.stop();
  });

  it("lands nested and array-row paths on their field, mounted late or not", async ({
    expect,
  }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    const ui = mount(
      alepha,
      <Probe
        onForm={(f) => (model = f)}
        refuse={
          new FormValidationError({
            message: "City unknown",
            path: "/address/city",
            issues: [
              { path: "/address/city", message: "City unknown" },
              { path: "/items/1/name", message: "Name taken" },
            ],
          })
        }
      />,
    );

    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(model?.errors).toEqual({
        "/address/city": "City unknown",
        "/items/1/name": "Name taken",
      });
    });
    await waitFor(() => expect(invalid("f-items-1-name")).toBe(true));
    expect(messageOf("f-items-1-name")).toContain("Name taken");
    expect(invalid("f-items-0-name")).toBe(false);

    // The city field did not exist when the submit failed.
    fireEvent.click(ui.getByText("show city"));
    await waitFor(() => expect(invalid("f-address.city")).toBe(true));
    expect(messageOf("f-address.city")).toContain("City unknown");

    await alepha.stop();
  });

  it("keeps a root path, or one naming no field, as the form-level error", async ({
    expect,
  }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    const ui = mount(
      alepha,
      <Probe
        onForm={(f) => (model = f)}
        refuse={
          new FormValidationError({
            message: "Quota reached",
            path: "",
            issues: [
              { path: "", message: "Quota reached" },
              { path: "/nowhere", message: "No such field" },
            ],
          })
        }
      />,
    );

    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(ui.getByTestId("form-error").textContent).toBe("Quota reached");
    });
    expect(model?.errors).toEqual({});
    expect(invalid("f-title")).toBe(false);

    await alepha.stop();
  });

  it("clears a field's error when it changes, and every error on reset and on a new submit", async ({
    expect,
  }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    const ui = mount(alepha, <Probe onForm={(f) => (model = f)} />);

    const fail = () =>
      act(() => {
        model!.setErrors([
          { path: "/title", message: "Bad title" },
          { path: "/email", message: "Bad email" },
          { path: "/items/0/name", message: "Bad row 0" },
          { path: "/items/1/name", message: "Bad row 1" },
        ]);
      });

    fail();
    await waitFor(() => expect(invalid("f-title")).toBe(true));

    // Only the edited field and the edited row lose their error.
    fireEvent.change(document.getElementById("f-title")!, {
      target: { value: "new" },
    });
    fireEvent.change(document.getElementById("f-items-0-name")!, {
      target: { value: "new" },
    });
    await waitFor(() => expect(invalid("f-title")).toBe(false));
    expect(model!.errors).toEqual({
      "/email": "Bad email",
      "/items/1/name": "Bad row 1",
    });
    expect(invalid("f-email")).toBe(true);
    expect(invalid("f-items-1-name")).toBe(true);

    act(() => model!.reset());
    expect(model!.errors).toEqual({});
    await waitFor(() => expect(invalid("f-email")).toBe(false));

    fail();
    await waitFor(() => expect(invalid("f-email")).toBe(true));
    fireEvent.submit(ui.getByTestId("form"));
    await waitFor(() => expect(invalid("f-email")).toBe(false));
    expect(model!.errors).toEqual({});

    await alepha.stop();
  });

  it("reports whether every issue landed on a field", async ({ expect }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    mount(alepha, <Probe onForm={(f) => (model = f)} />);

    expect(model!.setErrors([{ path: "/title", message: "x" }])).toBe(true);
    expect(
      model!.setErrors([
        { path: "/title", message: "x" },
        { path: "/nope", message: "y" },
      ]),
    ).toBe(false);
    expect(model!.errors).toEqual({ "/title": "x" });
    expect(model!.hasField("/items/3/name")).toBe(true);
    expect(model!.hasField("/items/x/name")).toBe(false);
    expect(model!.hasField("")).toBe(false);

    await alepha.stop();
  });
});
