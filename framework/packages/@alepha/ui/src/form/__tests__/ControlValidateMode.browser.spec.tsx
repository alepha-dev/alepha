import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { type FormModel, useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import { Control } from "../Control.tsx";

/**
 * `validate: "submit" | "blur" | "change"` (#Q3203): blur and change decode
 * the whole object and show only the touched field's issues, so an
 * object-level refinement still lands on the field it names.
 */
describe("useForm's validate option, through Control", () => {
  const schema = z
    .object({
      title: z.text({ minLength: 2 }),
      email: z.email(),
      password: z.text().optional(),
      confirm: z.text().optional(),
    })
    .refine((value) => value.password === value.confirm, {
      message: "Passwords do not match",
      path: ["confirm"],
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

  const el = (id: string) => document.getElementById(id)!;
  const invalid = (id: string) =>
    el(id).getAttribute("aria-invalid") === "true";
  const type = (id: string, value: string) =>
    fireEvent.change(el(id), { target: { value } });
  const leave = (id: string) => fireEvent.focusOut(el(id));

  interface ProbeProps {
    validate?: "submit" | "blur" | "change";
    onForm?: (form: FormModel<typeof schema>) => void;
  }

  const Probe = (props: ProbeProps) => {
    const form = useForm({
      id: "v",
      schema,
      validate: props.validate,
      handler: () => {},
    });
    props.onForm?.(form);
    return (
      <form {...form.props} data-testid="form">
        <Control input={form.input.title} label="Title" />
        <Control input={form.input.email} label="Email" />
        <Control input={form.input.password} label="Password" text />
        <Control input={form.input.confirm} label="Confirm" text />
      </form>
    );
  };

  it("checks nothing before submit by default", async ({ expect }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    mount(alepha, <Probe onForm={(f) => (model = f)} />);

    type("v-title", "x");
    leave("v-title");
    type("v-email", "nope");

    expect(model!.errors).toEqual({});
    expect(invalid("v-title")).toBe(false);

    await alepha.stop();
  });

  it("on blur, shows the left field's error and only that one", async ({
    expect,
  }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    mount(alepha, <Probe validate="blur" onForm={(f) => (model = f)} />);

    type("v-title", "x");
    expect(invalid("v-title")).toBe(false);
    leave("v-title");

    await waitFor(() => expect(invalid("v-title")).toBe(true));
    // The email is empty and wrong too, but nobody left it yet.
    expect(Object.keys(model!.errors)).toEqual(["/title"]);

    type("v-title", "long enough");
    leave("v-title");
    await waitFor(() => expect(invalid("v-title")).toBe(false));

    await alepha.stop();
  });

  it("on blur, lands an object-level refinement on the field it names", async ({
    expect,
  }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    mount(alepha, <Probe validate="blur" onForm={(f) => (model = f)} />);

    // zod runs an object's refinements once its fields pass, so the rest
    // of the form is valid here.
    type("v-title", "a title");
    type("v-email", "a@example.com");
    type("v-password", "secret");
    type("v-confirm", "other");
    leave("v-confirm");

    await waitFor(() => expect(invalid("v-confirm")).toBe(true));
    expect(model!.errors).toEqual({ "/confirm": "Passwords do not match" });

    await alepha.stop();
  });

  it("on change, checks the field as it is typed", async ({ expect }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    mount(alepha, <Probe validate="change" onForm={(f) => (model = f)} />);

    type("v-email", "nope");
    await waitFor(() => expect(invalid("v-email")).toBe(true));
    expect(Object.keys(model!.errors)).toEqual(["/email"]);

    type("v-email", "a@example.com");
    await waitFor(() => expect(invalid("v-email")).toBe(false));

    await alepha.stop();
  });

  it("after a refused submit, rechecks a field with an error on change, in any mode", async ({
    expect,
  }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    const ui = mount(alepha, <Probe onForm={(f) => (model = f)} />);

    type("v-title", "x");
    type("v-email", "nope");
    fireEvent.submit(ui.getByTestId("form"));
    await waitFor(() => {
      expect(invalid("v-title")).toBe(true);
      expect(invalid("v-email")).toBe(true);
    });

    // Still wrong: the error stays.
    type("v-email", "still-nope");
    expect(model!.errors["/email"]).toBeDefined();
    // Fixed: it leaves at once, the title's stays.
    type("v-email", "a@example.com");
    await waitFor(() => expect(invalid("v-email")).toBe(false));
    expect(Object.keys(model!.errors)).toEqual(["/title"]);

    await alepha.stop();
  });

  it("hears a blur from a Base UI picker, which writes through input.set", async ({
    expect,
  }) => {
    const alepha = await setup();
    let model: FormModel<any> | undefined;
    const Picker = (props: { onForm: (form: any) => void }) => {
      const form = useForm({
        id: "s",
        schema: z.object({ color: z.enum(["red", "blue"]) }),
        validate: "blur",
        handler: () => {},
      });
      props.onForm(form);
      return <Control input={form.input.color} label="Color" />;
    };
    const ui = mount(alepha, <Picker onForm={(f) => (model = f)} />);

    fireEvent.focusOut(ui.getByRole("combobox"));

    await waitFor(() => expect(Object.keys(model!.errors)).toEqual(["/color"]));

    await alepha.stop();
  });

  it("wires onBlur into the generated props of a hand-written input", async ({
    expect,
  }) => {
    const alepha = await setup();
    let model: FormModel<typeof schema> | undefined;
    const Plain = (props: { onForm: (form: any) => void }) => {
      const form = useForm({
        id: "p",
        schema,
        validate: "blur",
        handler: () => {},
      });
      props.onForm(form);
      return <input {...form.input.title.props} />;
    };
    mount(alepha, <Plain onForm={(f) => (model = f)} />);

    fireEvent.blur(el("p-title"));

    await waitFor(() => expect(Object.keys(model!.errors)).toEqual(["/title"]));

    await alepha.stop();
  });
});
