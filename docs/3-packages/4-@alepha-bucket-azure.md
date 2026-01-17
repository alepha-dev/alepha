# @alepha/bucket-azure - Bucket Azure

## Installation

```bash
npm install @alepha/bucket-azure
```

## Overview

Plugin for Alepha Bucket that provides Azure Blob Storage capabilities.

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### AzureFileStorageProvider

Azure Blog Storage implementation of File Storage Provider.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AZ_STORAGE_CONNECTION_STRING` | string | **Required** |  |
