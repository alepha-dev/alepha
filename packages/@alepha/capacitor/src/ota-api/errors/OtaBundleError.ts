import { $error } from "alepha";

/**
 * A bundle refused by `OtaBundleInspector`: the message says what was wrong
 * with it, and never echoes a key.
 */
export const OtaBundleError = $error({
  name: "OTA_BUNDLE",
  message: "Invalid OTA bundle",
});

export type OtaBundleError = InstanceType<typeof OtaBundleError>;
