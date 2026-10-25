import { $inject, Alepha } from "alepha";

/**
 * Answers one question for `AlephaMqtt`: is there a broker to talk to?
 *
 * There is when `MQTT_URL` is set, non-empty, in `alepha.env`, and the
 * runtime can open an MQTT socket (Node or Bun). The variable is read, never
 * a schema value with a default: a default would point every app at a
 * broker that is not there. Without it the client runs on the in-process
 * `MemoryMqttBroker`, which is what tests want.
 *
 * Shaped like `RedisActivation`, and read the same way: in the module's
 * `register`, from `alepha.env` as it stands then.
 */
export class MqttActivation {
  protected readonly alepha = $inject(Alepha);

  /**
   * True when `MQTT_URL` is set and non-empty, on Node or Bun.
   */
  public isActive(): boolean {
    if (!this.isServerRuntime()) {
      return false;
    }

    const url = this.alepha.env.MQTT_URL;
    return typeof url === "string" && url.trim() !== "";
  }

  /**
   * Node or Bun: neither a browser nor a Cloudflare Worker.
   */
  protected isServerRuntime(): boolean {
    if (this.alepha.isBrowser()) {
      return false;
    }

    return (
      typeof (globalThis as { Cloudflare?: unknown }).Cloudflare !== "object"
    );
  }
}
