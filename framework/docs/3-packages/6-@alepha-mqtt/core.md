# @alepha/mqtt - Core

MQTT 5 client and topic provider for Alepha framework.

## Installation

```bash
npm install @alepha/mqtt
```

## Overview

MQTT 5 client for Alepha.

A lifecycle-managed client with byte payloads, Last Will (settable by
code), reconnection and dispatch by Subscription Identifier.

- `MQTT_URL` set (Node or Bun): `MqttJsClientProvider`, on mqtt.js.
- Otherwise: `MemoryMqttClientProvider`, on an in-process broker.

An app's own `MqttClientProvider` substitution wins over both.

## API Reference

### Providers

- [`MemoryMqttClientProvider`](/docs/reference-providers-memorymqttclientprovider) - MQTT client on an in-process broker: no socket, no timing.
- [`MqttClientProvider`](/docs/reference-providers-mqttclientprovider) - MQTT 5 client provider.
- [`MqttJsClientProvider`](/docs/reference-providers-mqttjsclientprovider) - MQTT client provider backed by the `mqtt` npm package (mqtt.js).

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable   | Type | Default | Description                                                                                                                          |
| ---------- | ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MQTT_URL` | text | -       | MQTT broker URL (`mqtt://`, `mqtts://`, `ws://`, `wss://`). Set, it selects the mqtt.js client; unset, the in-process memory broker. |
