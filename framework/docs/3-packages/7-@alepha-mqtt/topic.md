# @alepha/mqtt - Topic

## Installation

```bash
npm install @alepha/mqtt
```

## Overview

`$topic` over MQTT, for device and integration topics.

Registers `MqttTopicProvider` as a service, with `AlephaMqtt` and
`AlephaTopic`, and leaves the app's `TopicProvider` alone: the framework's
own topics stay on memory or Redis, and a device topic opts in with
`provider: MqttTopicProvider`.

## API Reference

### Providers

- [`MqttTopicProvider`](/docs/reference-providers-mqtttopicprovider) - Topics over MQTT, for device and integration topics.
