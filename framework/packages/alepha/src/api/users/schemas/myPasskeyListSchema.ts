import { type Infer, z } from "alepha";

import { myPasskeySchema } from "./myPasskeySchema.ts";
import { passkeyProofKindSchema } from "./passkeyProofKindSchema.ts";

/**
 * The caller's passkeys, and the proof adding or removing one asks for, so
 * the page never re-derives the rule.
 */
export const myPasskeyListSchema = z.object({
  proof: passkeyProofKindSchema,
  items: z.array(myPasskeySchema),
});

export type MyPasskeyList = Infer<typeof myPasskeyListSchema>;
