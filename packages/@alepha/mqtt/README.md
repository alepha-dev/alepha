# Alepha @alepha/mqtt

MQTT client and topic provider for Alepha framework.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/mqtt
```

## Module

MQTT client module for Alepha.

Provides a lifecycle-managed MQTT client backed by `mqtt.js`.
Registers `MqttJsClientProvider` as the default implementation of `MqttClientProvider`.

## API Reference

### Providers

- [`MqttClientProvider`](https://alepha.dev/docs/reference-providers-mqttclientprovider) - Abstract MQTT client provider.
- [`MqttJsClientProvider`](https://alepha.dev/docs/reference-providers-mqttjsclientprovider) - MQTT client provider backed by the `mqtt` npm package (mqtt.js).

### Environment Variables

Environment variables used to configure this package.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MQTT_BROKER_URL` | text | mqtt://localhost:1883 | MQTT broker connection URL |
