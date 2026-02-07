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

- [`MemoryFileSystemProvider`](/docs/reference-providers-memoryfilesystemprovider) — In-memory implementation of FileSystemProvider for testing.
- [`MemoryShellProvider`](/docs/reference-providers-memoryshellprovider) — In-memory implementation of ShellProvider for testing.
- [`NodeFileSystemProvider`](/docs/reference-providers-nodefilesystemprovider) — Node.js implementation of FileSystem interface.
- [`NodeShellProvider`](/docs/reference-providers-nodeshellprovider) — Node.js implementation of ShellProvider.
