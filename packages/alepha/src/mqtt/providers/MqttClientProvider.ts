import type { UnSubscribeFn } from "alepha/topic";

/**
 * Abstract MQTT client provider.
 *
 * Low-level MQTT client for publish/subscribe messaging.
 * Analogous to `RedisProvider` — provides the transport layer
 * that higher-level modules like `alepha/topic/mqtt` build on.
 */
export abstract class MqttClientProvider {
  /**
   * Connect to the MQTT broker.
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
   */
  public abstract publish(
    topic: string,
    message: string,
    options?: MqttPublishOptions,
  ): Promise<void>;

  /**
   * Subscribe to an MQTT topic.
   * Callback receives the actual topic string as first arg (for wildcard matching).
   */
  public abstract subscribe(
    topic: string,
    callback: MqttMessageCallback,
    options?: MqttSubscribeOptions,
  ): Promise<UnSubscribeFn>;

  /**
   * Unsubscribe from an MQTT topic.
   */
  public abstract unsubscribe(topic: string): Promise<void>;
}

export interface MqttPublishOptions {
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export interface MqttSubscribeOptions {
  qos?: 0 | 1 | 2;
}

export type MqttMessageCallback = (
  topic: string,
  payload: string,
) => void | Promise<void>;
