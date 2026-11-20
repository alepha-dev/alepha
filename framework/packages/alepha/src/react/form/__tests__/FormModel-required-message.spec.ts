import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, it } from "vitest";

import { FormModel } from "../services/FormModel.ts";

describe("FormModel required message", () => {
  const setup = async (schema: any, initialValues: any = {}) => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const form = alepha.inject(FormModel, {
      lifetime: "transient",
      args: [
        "f1",
        {
          id: "f1",
          schema,
          handler: () => {},
          onError: () => {},
          initialValues,
        },
      ],
    }) as FormModel<any>;
    return form;
  };

  it("never names the schema key of a field left empty", async ({ expect }) => {
    const form = await setup(z.object({ identifier: z.string().min(1) }));

    await form.submit();

    expect(form.errors).toEqual({
      "/identifier": FormModel.REQUIRED_MESSAGE,
    });
  });

  it("reads a blank string as empty too", async ({ expect }) => {
    const form = await setup(z.object({ name: z.string().min(1) }), {
      name: "",
    });

    await form.submit();

    expect(form.errors).toEqual({ "/name": FormModel.REQUIRED_MESSAGE });
  });

  it("shows the field's own requiredMessage when it sets one", async ({
    expect,
  }) => {
    const form = await setup(
      z.object({
        email: z
          .string()
          .min(1)
          .meta({ requiredMessage: "Enter your email address" }),
      }),
    );

    await form.submit();

    expect(form.errors).toEqual({ "/email": "Enter your email address" });
  });

  it("keeps the schema's message when the field has a value", async ({
    expect,
  }) => {
    const form = await setup(z.object({ code: z.string().min(4) }), {
      code: "ab",
    });

    await form.submit();

    expect(form.errors["/code"]).not.toBe(FormModel.REQUIRED_MESSAGE);
    expect(form.errors["/code"]).toBeTruthy();
  });

  it("phrases a field checked on blur the same way", async ({ expect }) => {
    const form = await setup(z.object({ identifier: z.string().min(1) }));

    form.validateField("/identifier");

    expect(form.errors).toEqual({
      "/identifier": FormModel.REQUIRED_MESSAGE,
    });
  });

  it("leaves a message set by setErrors as it is", async ({ expect }) => {
    const form = await setup(z.object({ name: z.string().optional() }));

    form.setErrors([{ path: "/name", message: "Pick a name" }]);

    expect(form.errors).toEqual({ "/name": "Pick a name" });
  });
});
