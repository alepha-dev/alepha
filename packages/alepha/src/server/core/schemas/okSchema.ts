import type { Static } from "alepha";
import { z } from "alepha";

export const okSchema = z
  .object({
    ok: z.boolean().describe("True when operation succeed"),
    id: z.union([z.text(), z.integer()]).optional(),
    count: z.number().describe("Number of resources affected").optional(),
  })
  .meta({ title: "Ok" })
  .describe("Generic response after a successful operation on a resource");

export type Ok = Static<typeof okSchema>;
