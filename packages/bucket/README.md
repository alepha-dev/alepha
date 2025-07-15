# Alepha Bucket

A universal interface for object and file storage providers.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/bucket
```
## Module

Provides file storage capabilities through declarative bucket descriptors with support for multiple storage backends.

The bucket module enables unified file operations across different storage systems using the `$bucket` descriptor
on class properties. It abstracts storage provider differences, offering consistent APIs for local filesystem,
cloud storage, or in-memory storage for testing environments.

**Key Features:**
- Declarative bucket definition with `$bucket` descriptor
- Multiple storage backends (local, Azure Blob, memory, etc.)
- Unified file operations API across all providers
- Automatic file type detection and validation
- Memory provider for testing environments
- Integration with dependency injection system

**Basic Usage:**
```ts
import { Alepha, run } from "alepha";
import { AlephaBucket, $bucket } from "alepha/bucket";

class FileService {
  // Define a bucket for user uploads
  uploads = $bucket({
    name: "user-uploads",
  });

  // Define a bucket with custom provider
  documents = $bucket({
    name: "documents",
    provider: customFileStorageProvider,
  });

  async uploadUserAvatar(userId: string, fileData: Buffer) {
    const key = `avatars/${userId}.jpg`;
    await this.uploads.put(key, fileData);
    return key;
  }

  async getUserAvatar(userId: string) {
    const key = `avatars/${userId}.jpg`;
    return await this.uploads.get(key);
  }
}

const alepha = Alepha.create()
  .with(AlephaBucket)
  .with(FileService);

run(alepha);
```

**Testing with Memory Provider:**
```ts
class TestFileService {
  testBucket = $bucket({
    name: "test-files",
    // Uses memory provider by default for testing
  });

  async storeTestFile(filename: string, content: string) {
    await this.testBucket.put(filename, Buffer.from(content));
  }

  async getTestFile(filename: string) {
    return await this.testBucket.get(filename);
  }
}
```

**Production Configuration:**
```ts
import { AzureFileStorageProvider } from "alepha/bucket/azure";

class ProductionFileService {
  productionStorage = $bucket({
    name: "production-files",
    provider: new AzureFileStorageProvider({
      connectionString: process.env.AZURE_STORAGE_CONNECTION,
      container: "app-files",
    }),
  });
}
```

## API Reference

### Descriptors

#### $bucket()

Store files in a bucket. WIP
