# Alepha - File

## Installation

```bash
npm install alepha
```

## Overview

Provides file system capabilities for Alepha applications with support for multiple file sources and operations.

The file module enables working with files from various sources (URLs, buffers, streams) and provides
utilities for file type detection, content type determination, and common file system operations.

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### NodeFileSystemProvider

Node.js implementation of FileSystem interface.

```typescript
const fs = alepha.inject(NodeFileSystemProvider);

// Create from URL
const file1 = fs.createFile({ url: "file:///path/to/file.png" });

// Create from Buffer
const file2 = fs.createFile({ buffer: Buffer.from("hello"), name: "hello.txt" });

// Create from text
const file3 = fs.createFile({ text: "Hello, world!", name: "greeting.txt" });

// File operations
await fs.mkdir("/tmp/mydir", { recursive: true });
await fs.cp("/src/file.txt", "/dest/file.txt");
await fs.mv("/old/path.txt", "/new/path.txt");
const files = await fs.ls("/tmp");
await fs.rm("/tmp/file.txt");
```
