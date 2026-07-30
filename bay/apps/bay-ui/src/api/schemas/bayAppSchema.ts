import { z } from "alepha";

/**
 * One app instance as bay-go's control API reports it.
 */
export const bayAppSchema = z.object({
  name: z.text(),
  env: z.text(),
  domain: z.text(),
  release: z.text(),
  port: z.integer(),
  runtime: z.text(),
});
