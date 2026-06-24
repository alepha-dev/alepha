import { z } from "alepha";
import { $notification } from "alepha/api/notifications";

/**
 * Notification templates exercised by the notifications playground page.
 */
export class PlaygroundNotifications {
  public readonly welcomeEmail = $notification({
    category: "onboarding",
    schema: z.object({ username: z.text() }),
    email: {
      subject: "Welcome to the Alepha playground!",
      body: (v) => `Hello ${v.username}, welcome aboard.`,
    },
  });

  public readonly passwordReset = $notification({
    category: "security",
    critical: true,
    sensitive: true,
    schema: z.object({ username: z.text(), link: z.text() }),
    email: {
      subject: "Reset your password",
      body: (v) => `${v.username}, reset here: ${v.link}`,
    },
  });

  public readonly marketingBlast = $notification({
    category: "marketing",
    schema: z.object({ campaign: z.text() }),
    email: {
      subject: "News from Alepha",
      body: (v) => `Check out the latest: ${v.campaign}`,
    },
  });
}
