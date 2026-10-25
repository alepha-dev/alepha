import { $atom, type Infer, z } from "alepha";

/**
 * MQTT client configuration atom.
 *
 * `serverOnly` because the schema carries a plaintext broker `password`: this
 * value must never enter the SSR hydration payload, and DevTools must not
 * print it in `/metadata`.
 *
 * The broker URL is not here: it is `MQTT_URL`, read by `MqttActivation`.
 */
export const mqttOptions = $atom({
  name: "alepha.mqtt.options",
  schema: z.object({
    clientId: z
      .text({
        description: "MQTT client identifier. Auto-generated if omitted.",
      })
      .optional(),
    protocolVersion: z
      .union([z.literal(4), z.literal(5)])
      .describe(
        "MQTT protocol version: 5 (default) or 4 (MQTT 3.1.1). Under 4 there are no subscription identifiers, so shared subscriptions are refused.",
      )
      .default(5),
    keepalive: z
      .number()
      .describe("Keepalive interval in seconds.")
      .default(60),
    lazy: z
      .boolean()
      .describe(
        "When true, the connection is deferred until the first publish or subscribe.",
      )
      .default(false),
    username: z
      .string()
      .describe(
        "Username for broker authentication. Takes precedence over credentials embedded in MQTT_URL.",
      )
      .optional(),
    password: z
      .string()
      .describe("Password for broker authentication.")
      .optional(),
    reconnectPeriod: z
      .number()
      .describe(
        "Milliseconds between reconnection attempts. 0 disables automatic reconnection.",
      )
      .default(1000),
    will: z
      .object({
        topic: z.string().describe("Topic the broker publishes the will to."),
        payload: z
          .string()
          .describe(
            "Message body the broker publishes. Bytes go through `setWill()`.",
          ),
        qos: z
          .union([z.literal(0), z.literal(1), z.literal(2)])
          .describe("QoS used for the will message.")
          .default(0),
        retain: z
          .boolean()
          .describe("Whether the will message is retained.")
          .default(false),
      })
      .describe(
        "Last Will and Testament, published BY THE BROKER when this client disconnects ungracefully. `setWill()` replaces it by code.",
      )
      .optional(),
    connect: z
      .json()
      .describe(
        "Escape hatch: extra mqtt.js `IClientOptions` (`ca`, `cert`, `key`...) merged last, overriding everything above.",
      )
      .optional(),
  }),
  default: {
    protocolVersion: 5,
    keepalive: 60,
    lazy: false,
    reconnectPeriod: 1000,
  },
  serverOnly: true,
});

export type MqttOptions = Infer<typeof mqttOptions.schema>;

declare module "alepha" {
  interface State {
    [mqttOptions.key]: MqttOptions;
  }
}
