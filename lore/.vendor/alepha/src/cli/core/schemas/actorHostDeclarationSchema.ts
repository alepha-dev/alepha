import { z } from "alepha";
export const actorHostDeclarationSchema = z
  .object({
    exportName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
    module: z.string().min(1),
    moduleExport: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
    binding: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
    backend: z.enum(["sqlite", "kv"]),
  })
  .strict();
