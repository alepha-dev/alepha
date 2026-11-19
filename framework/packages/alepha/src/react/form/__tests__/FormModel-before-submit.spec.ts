import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, it } from "vitest";

import { FormModel } from "../services/FormModel.ts";

describe("FormModel beforeSubmit", () => {
  const setup = async (
    beforeSubmit: (values: any) => boolean | Promise<boolean>,
  ) => {
    const alepha = Alepha.create().with(AlephaLogger);
    const events: string[] = [];
    for (const name of [
      "form:submit:success",
      "form:submit:error",
      "form:submit:end",
    ] as const) {
      alepha.events.on(name, () => {
        events.push(name);
      });
    }
    await alepha.start();
    const sent: unknown[] = [];
    const seen: unknown[] = [];
    const form = alepha.inject(FormModel, {
      lifetime: "transient",
      args: [
        "f1",
        {
          id: "f1",
          schema: z.object({ name: z.text() }),
          handler: (values: unknown) => {
            sent.push(values);
          },
          beforeSubmit: (values: unknown) => {
            seen.push(values);
            return beforeSubmit(values);
          },
          initialValues: { name: "ada" },
        },
      ],
    }) as FormModel<any>;
    return { form, sent, seen, events };
  };

  it("runs the handler when it resolves true, with the decoded values", async ({
    expect,
  }) => {
    const { form, sent, seen, events } = await setup(async () => true);

    await form.submit();

    expect(seen).toEqual([{ name: "ada" }]);
    expect(sent).toEqual([{ name: "ada" }]);
    expect(events).toEqual(["form:submit:success", "form:submit:end"]);
  });

  it("cancels on false: no handler, no success or error, and the end still fires", async ({
    expect,
  }) => {
    const { form, sent, events } = await setup(() => false);

    await form.submit();

    expect(sent).toEqual([]);
    expect(events).toEqual(["form:submit:end"]);
  });
});
