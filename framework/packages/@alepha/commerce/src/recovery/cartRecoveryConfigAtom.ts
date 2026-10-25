import { $atom, type Infer, z } from "alepha";

export const cartRecoveryConfig = $atom({
  name: "alepha.commerce.recovery",
  description: "Timings for the abandoned-cart follow-up sequence.",
  schema: z.object({
    firstReminderAfterMinutes: z
      .integer()
      .min(1)
      .describe("Wait after the email lands before the first reminder."),
    secondReminderAfterMinutes: z
      .integer()
      .min(1)
      .describe("Wait after the first reminder before the second."),
    abandonAfterMinutes: z
      .integer()
      .min(1)
      .describe(
        "Wait after the second reminder before the session is marked abandoned.",
      ),
  }),
  default: {
    firstReminderAfterMinutes: 60,
    secondReminderAfterMinutes: 23 * 60,
    abandonAfterMinutes: 24 * 60,
  },
  serverOnly: true,
});

export type CartRecoveryConfig = Infer<typeof cartRecoveryConfig.schema>;

declare module "alepha" {
  interface State {
    [cartRecoveryConfig.key]: CartRecoveryConfig;
  }
}
