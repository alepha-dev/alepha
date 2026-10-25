import { $error } from "alepha";

/**
 * An SMS a provider could not send.
 */
export const SmsError = $error({
  name: "SMS",
  message: "Failed to send SMS",
});

export type SmsError = InstanceType<typeof SmsError>;
