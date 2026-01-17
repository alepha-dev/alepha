# Alepha @alepha/bucket Azure

Azure Blob Storage implementation for the bucket file storage.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Plugin for Alepha Bucket that provides Azure Blob Storage capabilities.

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](https://feunard.github.io/alepha/).

#### AzureFileStorageProvider

Azure Blog Storage implementation of File Storage Provider.

### Environment Variables

Environment variables used to configure this package.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AZ_STORAGE_CONNECTION_STRING` | string | **Required** |  |
