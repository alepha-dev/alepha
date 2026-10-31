import { $atom, type Infer, z } from "alepha";

export const cartRecoveryConfig = $atom({
  name: "alepha.commerce.recovery",
  description: "Timings for the abandoned-cart follow-up sequence.",
  schema: z.object({
    baseUrl: z
      .text()
      .describe(
        "The shop's public origin, e.g. `https://boutique.example`. An unsubscribe link is read in a mail client, where a relative one goes nowhere: set it wherever this module is on.",
      ),
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
    baseUrl: "",
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
