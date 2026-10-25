import { $error } from "../primitives/$error.ts";

/**
 * A service registered after the container has started.
 */
export const ContainerLockedError = $error({
  name: "CONTAINER_LOCKED",
  message: "Container is locked. No more providers can be added.",
});

export type ContainerLockedError = InstanceType<typeof ContainerLockedError>;
