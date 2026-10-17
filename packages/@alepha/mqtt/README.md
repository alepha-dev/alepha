# Alepha @alepha/mqtt

MQTT 5 client and topic provider for Alepha framework.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/mqtt
```

## Module

MQTT 5 client for Alepha.

A lifecycle-managed client with byte payloads, Last Will (settable by
code), reconnection and dispatch by Subscription Identifier.

- `MQTT_URL` set (Node or Bun): `MqttJsClientProvider`, on mqtt.js.
- Otherwise: `MemoryMqttClientProvider`, on an in-process broker.

An app's own `MqttClientProvider` substitution wins over both.

## API Reference

### Providers

- [`MemoryMqttClientProvider`](https://alepha.dev/docs/reference-providers-memorymqttclientprovider) - MQTT client on an in-process broker: no socket, no timing.
- [`MqttClientProvider`](https://alepha.dev/docs/reference-providers-mqttclientprovider) - MQTT 5 client provider.
- [`MqttJsClientProvider`](https://alepha.dev/docs/reference-providers-mqttjsclientprovider) - MQTT client provider backed by the `mqtt` npm package (mqtt.js).

### Environment Variables

Environment variables used to configure this package.

| Variable   | Type | Default | Description                                                                                                                          |
| ---------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MQTT_URL` | text | -       | MQTT broker URL (`mqtt://`, `mqtts://`, `ws://`, `wss://`). Set, it selects the mqtt.js client; unset, the in-process memory broker. |
