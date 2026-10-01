import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, SchemaValidationError, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { describe, expect, it } from "vitest";

import { FormValidationError, useForm, useFormState } from "../index.ts";

/**
 * Which failed submits a form has already shown (#Q2345).
 *
 * Two cases carry `handled: true` on `react:action:error`: the form was given
 * an `onError`, and a `FormValidationError` names a field, since
 * `useFormState` pins it under that field. Before, both toasted wherever an
 * `ActionErrorToaster` was mounted: a wrong password on the login page showed
 * under the field and again as a toast.
 */
describe("useForm handled errors", () => {
  interface Seen {
    error: Error;
    handled?: boolean;
  }

  const setup = async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const seen: Seen[] = [];
    alepha.events.on("react:action:error", (event) => {
      seen.push({ error: event.error, handled: event.handled });
    });
    return { alepha, seen };
  };

  interface PasswordFormProps {
    fail: () => never;
    onError?: (error: Error) => void;
  }

  const PasswordForm = (props: PasswordFormProps) => {
    const form = useForm({
      schema: z.object({ password: z.text() }),
      handler: () => props.fail(),
      onError: props.onError,
    });
    const state = useFormState({ form, path: "/password" }, ["error"]);
    return (
      <form {...form.props} data-testid="form">
        <input {...form.input.password.props} data-testid="password" />
        <span data-testid="password-error">{state.error?.message ?? ""}</span>
      </form>
    );
  };

  const submit = (ui: ReturnType<typeof render>) => {
    fireEvent.change(ui.getByTestId("password"), {
      target: { value: "hunter2" },
    });
    fireEvent.submit(ui.getByTestId("form"));
  };

  it("marks a FormValidationError with a field path handled, and shows it under the field", async () => {
    const { alepha, seen } = await setup();
    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <PasswordForm
          fail={() => {
            throw new FormValidationError({
              message: "Invalid identifier or password",
              path: "/password",
            });
          }}
        />
      </AlephaContext.Provider>,
    );

    submit(ui);

    await waitFor(() => {
      expect(ui.getByTestId("password-error").textContent).toContain(
        "Invalid identifier or password",
      );
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].handled).toBe(true);

    await alepha.stop();
  });

  it("does not mark a FormValidationError with no path, which has nowhere to render", async () => {
    const { alepha, seen } = await setup();
    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <PasswordForm
          fail={() => {
            throw new FormValidationError({
              message: "Refused as a whole",
              path: "",
            });
          }}
        />
      </AlephaContext.Provider>,
    );

    submit(ui);

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].handled).toBe(false);

    await alepha.stop();
  });

  /**
   * A response that broke its own schema, surfacing through the form that
   * sent the request. Its path points into the response, not into this form,
   * so nothing renders it: a fault, and it must still toast.
   */
  it("does not mark a SchemaValidationError raised inside the handler", async () => {
    const { alepha, seen } = await setup();
    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <PasswordForm
          fail={() => {
            throw new SchemaValidationError({
              message: "'id' is required",
              instancePath: "/id",
            });
          }}
        />
      </AlephaContext.Provider>,
    );

    submit(ui);

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].handled).toBe(false);

    await alepha.stop();
  });

  it("does not mark a plain throw", async () => {
    const { alepha, seen } = await setup();
    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <PasswordForm
          fail={() => {
            throw new Error("Server exploded");
          }}
        />
      </AlephaContext.Provider>,
    );

    submit(ui);

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].handled).toBe(false);

    await alepha.stop();
  });

  it("marks any failure handled when the form was given an onError, and still calls it", async () => {
    const { alepha, seen } = await setup();
    const received: Error[] = [];
    const ui = render(
      <AlephaContext.Provider value={alepha}>
        <PasswordForm
          fail={() => {
            throw new Error("Slug taken");
          }}
          onError={(error) => received.push(error)}
        />
      </AlephaContext.Provider>,
    );

    submit(ui);

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].handled).toBe(true);
    expect(received.map((it) => it.message)).toEqual(["Slug taken"]);

    await alepha.stop();
  });
});
