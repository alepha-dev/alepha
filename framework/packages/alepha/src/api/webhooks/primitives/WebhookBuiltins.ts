import { z } from "alepha";

import { $webhook } from "./$webhook.ts";

/**
 * The events the module itself declares.
 */
export class WebhookBuiltins {
  /**
   * The event "Send test event" delivers to one endpoint, whatever it
   * subscribes to, so an operator sees the receiver's answer.
   */
  public readonly test = $webhook({
    name: "webhook.test",
    description:
      "A test event sent by an operator to check that the endpoint receives and verifies deliveries. It carries no business data.",
    schema: z.object({ message: z.text() }),
  });
}
