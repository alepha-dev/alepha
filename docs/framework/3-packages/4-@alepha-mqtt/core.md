# @alepha/mqtt - Core

MQTT client and topic provider for Alepha framework.

## Installation

```bash
npm install @alepha/mqtt
```

## Overview

MQTT client module for Alepha.

Provides a lifecycle-managed MQTT client backed by `mqtt.js`.
Registers `MqttJsClientProvider` as the default implementation of `MqttClientProvider`.

## API Reference

### Providers

- [`MqttClientProvider`](/docs/reference-providers-mqttclientprovider) - Abstract MQTT client provider.
- [`MqttJsClientProvider`](/docs/reference-providers-mqttjsclientprovider) - MQTT client provider backed by the `mqtt` npm package (mqtt.js).

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MQTT_BROKER_URL` | text | mqtt://localhost:1883 | MQTT broker connection URL |
