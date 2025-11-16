# Alepha @bucket Azure

Azure Blob Storage implementation for the bucket file storage.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Plugin for Alepha Bucket that provides Azure Blob Storage capabilities.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { Alepha@bucketAzure } from "alepha/bucket/azure";

const alepha = Alepha.create()
	.with(Alepha@bucketAzure);

run(alepha);
```

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### AzureFileStorageProvider

Azure Blog Storage implementation of File Storage Provider.
