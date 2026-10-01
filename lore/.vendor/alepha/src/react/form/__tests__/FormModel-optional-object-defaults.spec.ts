import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, expect, it } from "vitest";

import { FormModel } from "../services/FormModel.ts";

/**
 * Default extraction descended into optional objects, so an `address` the user
 * never opened was submitted as `{ country: "FR" }` while `ControlObject` drew
 * it as not initialised: the payload disagreed with the screen.
 */
describe("FormModel defaults on nested objects", () => {
  const schema = z.object({
    name: z.text().default("anon"),
    address: z
      .object({
        country: z.text().default("FR"),
        city: z.text().optional(),
      })
      .optional(),
    billing: z
      .object({
        currency: z.text().default("EUR"),
      })
      .nullable(),
    settings: z.object({
      theme: z.text().default("dark"),
    }),
  });

  const makeForm = (
    alepha: Alepha,
    initialValues?: Record<string, any>,
  ): FormModel<any> =>
    alepha.inject(FormModel as any, {
      lifetime: "transient",
      args: ["f1", { id: "f1", schema, handler: () => {}, initialValues }],
    }) as FormModel<any>;

  const create = async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    return alepha;
  };

  it("should leave an untouched optional object absent", async () => {
    const form = makeForm(await create());

    expect(form.currentValues).not.toHaveProperty("address");
  });

  it("should leave an untouched nullable object absent", async () => {
    const form = makeForm(await create());

    expect(form.currentValues).not.toHaveProperty("billing");
  });

  it("should still seed a required nested object", async () => {
    const form = makeForm(await create());

    expect(form.currentValues).toMatchObject({
      name: "anon",
      settings: { theme: "dark" },
    });
  });

  it("should apply the inner defaults once the object is initialised", async () => {
    const form = makeForm(await create());

    form.input.address.set({});

    expect(form.currentValues.address).toEqual({ country: "FR" });
  });

  it("should keep initial values over the defaults", async () => {
    const form = makeForm(await create(), {
      address: { country: "BE", city: "Ghent" },
    });

    expect(form.currentValues.address).toEqual({
      country: "BE",
      city: "Ghent",
    });
  });

  it("should not resurrect the object after it is cleared", async () => {
    const form = makeForm(await create(), { address: { country: "BE" } });

    form.input.address.set(undefined);

    expect(form.currentValues.address).toBeUndefined();
  });
});
