import type { Infer } from "alepha";

import { stackDeployments } from "../entities/stackDeployments.ts";

/**
 * A stack deploy as the console shows it: the row, with its plan, services
 * and warnings still JSON text the page parses. Nothing in it is secret.
 */
export const stackDeploymentResourceSchema = stackDeployments.schema.omit({
  estateId: true,
});

export type StackDeploymentResource = Infer<
  typeof stackDeploymentResourceSchema
>;
