# Alepha - System

## Installation

Part of the `alepha` package. Import from `alepha/system`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.14.0 | node, bun, browser|

System-level abstractions for portable code across runtimes.

**Features:**
- File system operations (read, write, exists, etc.)
- Shell command execution
- File type detection and MIME utilities
- Memory implementations for testing

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

#### MemoryShellProvider

In-memory implementation of ShellProvider for testing.

Records all commands that would be executed without actually running them.
Can be configured to return specific outputs or throw errors for testing.

```typescript
// In tests, substitute the real ShellProvider with MemoryShellProvider
const alepha = Alepha.create().with({
  provide: ShellProvider,
  use: MemoryShellProvider,
});

// Configure mock behavior
const shell = alepha.inject(MemoryShellProvider);
shell.configure({
  outputs: { "echo hello": "hello\n" },
  errors: { "failing-cmd": "Command failed" },
});

// Or use the fluent API
shell.outputs.set("another-cmd", "output");
shell.errors.set("another-error", "Error message");

// Run code that uses ShellProvider
const service = alepha.inject(MyService);
await service.doSomething();

// Verify commands were called
expect(shell.calls).toHaveLength(2);
expect(shell.calls[0].command).toBe("yarn install");
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

#### NodeShellProvider

Node.js implementation of ShellProvider.

Executes shell commands using Node.js child_process module.
Supports binary resolution from node_modules/.bin for local packages.
