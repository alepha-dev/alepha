/**
 * Abstract MQTT client provider.
 *
 * Low-level MQTT client for publish/subscribe messaging.
 * Analogous to `RedisProvider` — provides the transport layer
 * that higher-level modules like `@alepha/mqtt/topic` build on.
 */
export abstract class MqttClientProvider {
  /**
   * Connect to the MQTT broker.
   *
   * Calling this while a connection is already open, or while another
   * `connect()` is still in flight, resolves against that connection instead
   * of opening a second one.
   */
  public abstract connect(): Promise<void>;

  /**
   * Disconnect from the MQTT broker.
   */
  public abstract disconnect(): Promise<void>;

  /**
   * Whether the client is currently connected.
   */
  public abstract get isConnected(): boolean;

  /**
   * Publish a message to an MQTT topic.
   *
   * With `qos` 1 or 2 the returned promise resolves only once the broker has
   * acknowledged the message. With `qos` 0 (the default) it resolves as soon
   * as the packet has been written to the socket.
   */
  public abstract publish(
    topic: string,
    message: string,
    options?: MqttPublishOptions,
  ): Promise<void>;

  /**
   * Subscribe to an MQTT topic filter.
   *
   * The returned promise resolves once the broker has acknowledged the
   * subscription, so a publish issued afterwards cannot be missed.
   *
   * The callback receives the actual topic the message was published to as
   * its first argument, which is what makes wildcard filters usable.
   */
  public abstract subscribe(
    topic: string,
    callback: MqttMessageCallback,
    options?: MqttSubscribeOptions,
  ): Promise<() => Promise<void>>;

  /**
   * Unsubscribe every callback registered on an MQTT topic filter.
   */
  public abstract unsubscribe(topic: string): Promise<void>;
}

export interface MqttPublishOptions {
  qos?: MqttQoS;
  retain?: boolean;
}

export interface MqttSubscribeOptions {
  qos?: MqttQoS;
}

/**
 * MQTT Quality of Service level.
 *
 * - `0`: at most once (fire and forget)
 * - `1`: at least once (acknowledged delivery)
 * - `2`: exactly once (four-step handshake)
 */
export type MqttQoS = 0 | 1 | 2;

export type MqttMessageCallback = (
  topic: string,
  payload: string,
) => void | Promise<void>;
