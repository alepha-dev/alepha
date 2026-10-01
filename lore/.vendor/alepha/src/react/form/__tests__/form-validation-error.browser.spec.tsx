import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, SchemaValidationError, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { FormValidationError, useForm, useFormState } from "../index.ts";

/**
 * The forms guide documents throwing `FormValidationError` from a handler to
 * report a field-level error. The class was exported and referenced nowhere,
 * so nothing pinned that the documented flow actually reaches the field.
 */
describe("FormValidationError", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const EmailForm = () => {
    const form = useForm({
      schema: z.object({ email: z.text(), name: z.text().optional() }),
      handler: (values) => {
        if (values.email === "taken@example.com") {
          throw new FormValidationError({
            message: "Email already in use",
            path: "/email",
          });
        }
      },
    });

    const emailState = useFormState({ form, path: "/email" }, ["error"]);
    const nameState = useFormState({ form, path: "/name" }, ["error"]);

    return (
      <form {...form.props} data-testid="form">
        <input {...form.input.email.props} data-testid="email" />
        <input {...form.input.name.props} data-testid="name" />
        <span data-testid="email-error">{emailState.error?.message ?? ""}</span>
        <span data-testid="name-error">{nameState.error?.message ?? ""}</span>
        <button type="submit">Submit</button>
      </form>
    );
  };

  it("routes the error to the field named by `path`", async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const ui = mount(alepha, <EmailForm />);

    fireEvent.change(ui.getByTestId("email"), {
      target: { value: "taken@example.com" },
    });
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(ui.getByTestId("email-error").textContent).toContain(
        "Email already in use",
      );
    });

    // and only to that field
    expect(ui.getByTestId("name-error").textContent).toBe("");

    await alepha.stop();
  });

  it("clears the field error once the field changes", async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const ui = mount(alepha, <EmailForm />);

    fireEvent.change(ui.getByTestId("email"), {
      target: { value: "taken@example.com" },
    });
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(ui.getByTestId("email-error").textContent).not.toBe("");
    });

    fireEvent.change(ui.getByTestId("email"), {
      target: { value: "free@example.com" },
    });

    await waitFor(() => {
      expect(ui.getByTestId("email-error").textContent).toBe("");
    });

    await alepha.stop();
  });

  /**
   * The schema's own refusal arrives as the same type a handler throws, so
   * whoever listens to `react:action:error` can tell a person's input from a
   * fault (blight #585, #Q2343). It still reaches the field.
   */
  it("hands on the schema's own refusal as a FormValidationError", async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const seen: Array<{ type: string; error: Error }> = [];
    alepha.events.on("react:action:error", (event) => {
      seen.push(event);
    });
    const ui = mount(alepha, <EmailForm />);

    // `email` is required and never filled in.
    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(ui.getByTestId("email-error").textContent).toContain("email");
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("form");
    expect(seen[0].error).toBeInstanceOf(FormValidationError);
    expect(seen[0].error.name).toBe("ValidationError");
    expect((seen[0].error as FormValidationError).value.path).toBe("/email");

    await alepha.stop();
  });

  it("leaves a SchemaValidationError thrown by the handler as it is", async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const seen: Error[] = [];
    alepha.events.on("react:action:error", (event) => {
      seen.push(event.error);
    });
    const BrokenResponseForm = () => {
      const form = useForm({
        schema: z.object({ email: z.text() }),
        handler: () => {
          // What a response that broke its own schema looks like from here.
          throw new SchemaValidationError({
            message: "'id' is required",
            instancePath: "/id",
          });
        },
      });
      return (
        <form {...form.props} data-testid="broken">
          <input {...form.input.email.props} data-testid="broken-email" />
        </form>
      );
    };
    const ui = mount(alepha, <BrokenResponseForm />);

    fireEvent.change(ui.getByTestId("broken-email"), {
      target: { value: "a@example.com" },
    });
    fireEvent.submit(ui.getByTestId("broken"));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).not.toBeInstanceOf(FormValidationError);
    expect(seen[0].name).toBe("SchemaValidationError");

    await alepha.stop();
  });

  it("carries the pointer on `value.path` so consumers can match it", () => {
    const error = new FormValidationError({
      message: "Email already in use",
      path: "/email",
    });

    expect(error.value.path).toBe("/email");
    expect(error.value.message).toBe("Email already in use");
  });

  it("supports nested pointers", () => {
    const error = new FormValidationError({
      message: "Unknown city",
      path: "/address/city",
    });

    expect(error.value.path).toBe("/address/city");
  });
});
