import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, it } from "vitest";

import { FormModel } from "../services/FormModel.ts";

/**
 * Repro for: a form whose submit fails TypeBox validation (missing field)
 * leaves the submit button stuck in its loading state forever.
 *
 * The button's loading is driven by the `form:submit:begin` / `form:submit:end`
 * event pair (see useFormState). So the invariant that matters is: every
 * `form:submit:begin` is followed by a `form:submit:end`, even when validation
 * throws AND even when a downstream error listener (e.g. the action-error
 * toaster) itself throws.
 */
describe("FormModel.submit loading pairing", () => {
  const makeForm = (alepha: Alepha) =>
    alepha.inject(FormModel as any, {
      lifetime: "transient",
      args: [
        "f1",
        {
          id: "f1",
          schema: z.object({ email: z.text(), password: z.text() }),
          handler: () => {},
          initialValues: {}, // both required fields missing → decode throws
        },
      ],
    }) as FormModel<any>;

  it("emits form:submit:end on a validation error (intrinsic)", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const form = makeForm(alepha);
    let begun = false;
    let ended = false;
    alepha.events.on("form:submit:begin", () => {
      begun = true;
    });
    alepha.events.on("form:submit:end", () => {
      ended = true;
    });

    await form.submit().catch(() => {});

    expect(begun).toBe(true);
    expect(ended).toBe(true); // pairing must hold
  });

  it("emits form:submit:end even when a react:action:error listener throws", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const form = makeForm(alepha);
    let ended = false;
    alepha.events.on("form:submit:end", () => {
      ended = true;
    });
    // Simulates a globally-mounted listener (e.g. ActionErrorToaster) throwing.
    alepha.events.on("react:action:error", () => {
      throw new Error("toaster boom");
    });

    await form.submit().catch(() => {});

    expect(ended).toBe(true); // currently FAILS: end is skipped → button stuck
  });
});
