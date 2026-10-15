import { $error } from "alepha";

/**
 * An email a provider could not send.
 */
export const EmailError = $error({
  name: "EMAIL",
  message: "Failed to send email",
});

export type EmailError = InstanceType<typeof EmailError>;
