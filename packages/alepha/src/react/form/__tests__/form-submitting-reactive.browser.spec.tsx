import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { describe, it } from "vitest";
import { useForm, useFormState } from "../index.ts";

/**
 * Submit buttons bind their loading state to `useFormState(form, ["loading"])`
 * (the reactive form-state API; the non-reactive `form.submitting` getter was
 * removed). This loading must:
 *  - turn ON while an async submit is in flight, and
 *  - turn OFF again afterwards — including after a TypeBox validation error.
 *
 * The OFF guarantee relies on `FormModel.submit` always emitting
 * `form:submit:end` (see FormModel-submit-loading.spec.ts).
 */
describe("useFormState loading drives the submit button", () => {
  const mount = (alepha: Alepha, ui: React.ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  it("turns loading on during an async submit and off after", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    let release!: () => void;

    const Form = () => {
      const form = useForm({
        id: "async",
        schema: z.object({ name: z.string().min(1) }),
        initialValues: { name: "ok" },
        handler: () => new Promise<void>((r) => (release = r)),
      });
      const { loading } = useFormState(form, ["loading"]);
      return (
        <form {...form.props} data-testid="form">
          <button
            type="submit"
            data-testid="submit"
            data-loading={loading ? "true" : "false"}
          >
            go
          </button>
        </form>
      );
    };

    const { getByTestId } = mount(alepha, <Form />);
    fireEvent.submit(getByTestId("form"));

    await waitFor(() =>
      expect(getByTestId("submit").getAttribute("data-loading")).toBe("true"),
    );
    release();
    await waitFor(() =>
      expect(getByTestId("submit").getAttribute("data-loading")).toBe("false"),
    );
  });

  it("clears loading after a TypeBox validation error", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaLogger);

    const Form = () => {
      const form = useForm({
        id: "login",
        schema: z.object({
          identifier: z.string().min(1),
          password: z.string().min(6),
        }),
        handler: async () => {},
      });
      const { loading } = useFormState(form, ["loading"]);
      return (
        <form {...form.props} data-testid="form">
          <button
            type="submit"
            data-testid="submit"
            data-loading={loading ? "true" : "false"}
          >
            Sign in
          </button>
        </form>
      );
    };

    const { getByTestId } = mount(alepha, <Form />);
    fireEvent.submit(getByTestId("form")); // empty → validation error

    await waitFor(() =>
      expect(getByTestId("submit").getAttribute("data-loading")).toBe("false"),
    );
  });
});
