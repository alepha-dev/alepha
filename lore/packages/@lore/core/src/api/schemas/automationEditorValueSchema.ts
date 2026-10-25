import { z } from "alepha";

export const automationEditorValueSchema = z.object({
  mode: z.enum(["literal", "binding"]),
  text: z.string().optional(),
  number: z.number().optional(),
  boolean: z.boolean().optional(),
  binding: z.string().optional(),
});
