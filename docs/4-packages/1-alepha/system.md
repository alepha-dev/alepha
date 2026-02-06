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

#### MemoryShellProvider

In-memory implementation of ShellProvider for testing.

Records all commands that would be executed without actually running them.
Can be configured to return specific outputs or throw errors for testing.

#### NodeFileSystemProvider

Node.js implementation of FileSystem interface.

#### NodeShellProvider

Node.js implementation of ShellProvider.

Executes shell commands using Node.js child_process module.
Supports binary resolution from node_modules/.bin for local packages.
