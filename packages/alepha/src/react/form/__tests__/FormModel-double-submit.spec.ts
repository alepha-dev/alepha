import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, expect, it } from "vitest";
import { FormModel } from "../services/FormModel.ts";

describe("FormModel.submit double-submit guard", () => {
  const makeForm = (alepha: Alepha, handler: () => Promise<void> | void) =>
    alepha.inject(FormModel as any, {
      lifetime: "transient",
      args: [
        "f1",
        {
          id: "f1",
          schema: z.object({ email: z.text() }),
          handler,
          initialValues: { email: "a@b.c" },
        },
      ],
    }) as FormModel<any>;

  it("should run the handler once when a listener defers the begin events", async () => {
    // `submitInProgress` used to be set only AFTER the two awaited
    // `react:action:begin` / `form:submit:begin` emits. Any async listener on
    // either — a toaster, an analytics call — opened a window in which a
    // second submit passed the guard: a double-clicked "Pay" button ran the
    // handler twice.
    const alepha = Alepha.create().with(AlephaLogger);
    alepha.events.on(
      "form:submit:begin",
      () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
    );
    await alepha.start();

    let calls = 0;
    const form = makeForm(alepha, () => {
      calls++;
    });

    await Promise.all([form.submit(), form.submit()]);

    expect(calls).toBe(1);
  });

  it("should accept a second submit once the first has settled", async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();

    let calls = 0;
    const form = makeForm(alepha, () => {
      calls++;
    });

    await form.submit();
    await form.submit();

    expect(calls).toBe(2);
  });
});
