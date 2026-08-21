import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
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
