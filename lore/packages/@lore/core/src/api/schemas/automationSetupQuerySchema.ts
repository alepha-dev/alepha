import { z } from "alepha";

import { automationPageQuerySchema } from "./automationPageQuerySchema.ts";

export const automationSetupQuerySchema = automationPageQuerySchema
  .extend({
    kind: z.enum([
      "member",
      "folio",
      "app",
      "quest",
      "release",
      "epic",
      "feedback",
      "deployment",
    ]),
  })
  .strict();
