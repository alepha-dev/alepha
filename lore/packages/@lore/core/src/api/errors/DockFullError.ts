import { z } from "alepha";
import { ConflictError } from "alepha/server";

/**
 * The dock already holds as many projects as it can (#E139). A 409, typed so
 * a client can tell it from any other refusal and point at the pin settings.
 */
export const DockFullError = ConflictError.extend({
  name: "DOCK_FULL",
  schema: z.object({ cap: z.integer() }),
  message: (data) =>
    `Your dock is full: it holds ${data.cap} projects. Unpin one first.`,
});

export type DockFullError = InstanceType<typeof DockFullError>;
