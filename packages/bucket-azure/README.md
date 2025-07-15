# Alepha Bucket Azure

Azure Blob Storage implementation for the bucket file storage.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/bucket-azure
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaBucketAzure } from "alepha/bucket/azure";

const alepha = Alepha.create()
  .with(AlephaBucketAzure);

run(alepha);
```

Alepha Bucket Azure Module

Plugin for Alepha Bucket that provides Azure Blob Storage capabilities.

## API Reference

### Providers

#### AzureFileStorageProvider

Azure Blog Storage implementation of File Storage Provider.
