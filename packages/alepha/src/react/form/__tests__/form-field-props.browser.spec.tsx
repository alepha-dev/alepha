import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useForm } from "../index.ts";

describe("form field props", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  it("should carry typed input through to the submit handler", async () => {
    // This is `useForm`'s own JSDoc example. `props` used to carry only id /
    // name / type / validation attributes — no value, no onChange — so
    // everything the user typed stayed in the DOM and the handler received an
    // empty object. Every real consumer had to reach for `useFieldValue`.
    const submitted: Array<Record<string, unknown>> = [];

    const Form = () => {
      const form = useForm({
        schema: z.object({
          username: z.text(),
          password: z.text(),
        }),
        handler: (values) => {
          submitted.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="form">
          <input {...form.input.username.props} data-testid="username" />
          <input {...form.input.password.props} data-testid="password" />
          <button type="submit">Submit</button>
        </form>
      );
    };

    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const ui = mount(alepha, <Form />);

    fireEvent.change(ui.getByTestId("username"), {
      target: { value: "ada" },
    });
    fireEvent.change(ui.getByTestId("password"), {
      target: { value: "hunter2" },
    });
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(submitted).toEqual([{ username: "ada", password: "hunter2" }]);
    });
  });

  it("should seed the input from initialValues", async () => {
    const Form = () => {
      const form = useForm({
        schema: z.object({ username: z.text() }),
        initialValues: { username: "ada" },
        handler: () => {},
      });

      return <input {...form.input.username.props} data-testid="username" />;
    };

    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const ui = mount(alepha, <Form />);

    expect((ui.getByTestId("username") as HTMLInputElement).value).toBe("ada");
  });

  it("should read a checkbox from `checked`, not `value`", async () => {
    const submitted: Array<Record<string, unknown>> = [];

    const Form = () => {
      const form = useForm({
        schema: z.object({ terms: z.boolean() }),
        initialValues: { terms: false },
        handler: (values) => {
          submitted.push(values);
        },
      });

      return (
        <form {...form.props} data-testid="form">
          <input {...form.input.terms.props} data-testid="terms" />
          <button type="submit">Submit</button>
        </form>
      );
    };

    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const ui = mount(alepha, <Form />);

    fireEvent.click(ui.getByTestId("terms"));
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(submitted).toEqual([{ terms: true }]);
    });
  });
});
