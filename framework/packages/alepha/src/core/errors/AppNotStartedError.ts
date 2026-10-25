import { $error } from "../primitives/$error.ts";

/**
 * A call that needs a started app, made before `alepha.start()`.
 */
export const AppNotStartedError = $error({
  name: "APP_NOT_STARTED",
  message: "App not started. Please start the app before.",
});

export type AppNotStartedError = InstanceType<typeof AppNotStartedError>;
