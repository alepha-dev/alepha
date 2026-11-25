/**
 * The browser-safe schemas of `@lore/prompts` (#E175).
 *
 * What a browser page or an end-to-end spec may import as a runtime value.
 * Nothing here reaches a server-only module. The schemas Plan, Ship and
 * Requirements write in (`promptArgSchema`, `promptResourceSchema`, ...)
 * are core's contract, in `@lore/core/schemas`.
 *
 * @module
 */
export { type Prompt, prompts } from "../api/entities/prompts.ts";
export {
  type PromptCreate,
  promptCreateSchema,
} from "../api/schemas/promptCreateSchema.ts";
export {
  type PromptWrite,
  promptWriteSchema,
} from "../api/schemas/promptWriteSchema.ts";
