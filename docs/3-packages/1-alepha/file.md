# Alepha - File

## Installation

Part of the `alepha` package. Import from `alepha/file`.

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

For more details, see the [Providers documentation](/docs/concepts-providers).

#### MemoryFileSystemProvider

In-memory implementation of FileSystemProvider for testing.

This provider stores all files and directories in memory, making it ideal for
unit tests that need to verify file operations without touching the real file system.

```typescript
// In tests, substitute the real FileSystemProvider with MemoryFileSystemProvider
const alepha = Alepha.create().with({
  provide: FileSystemProvider,
  use: MemoryFileSystemProvider,
});

// Run code that uses FileSystemProvider
const service = alepha.inject(MyService);
await service.saveFile("test.txt", "Hello World");

// Verify the file was written
const memoryFs = alepha.inject(MemoryFileSystemProvider);
expect(memoryFs.files.get("test.txt")?.toString()).toBe("Hello World");
```

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
