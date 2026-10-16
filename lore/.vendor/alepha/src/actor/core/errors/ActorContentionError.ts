import { $error } from "alepha";

/**
 * An actor transition that kept losing the race for its state until its
 * retries ran out.
 */
export const ActorContentionError = $error({
  name: "ACTOR_CONTENTION",
  message: "Actor transition contention exhausted",
});

export type ActorContentionError = InstanceType<typeof ActorContentionError>;
