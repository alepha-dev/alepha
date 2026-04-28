# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alepha is a convention-driven TypeScript framework for building robust, end-to-end type-safe applications.
This is a monorepo workspace using Yarn workspaces with the following structure:

- `apps/*` - Example applications
- `packages/*` - Framework workspace

## Environment Variables for Commands

When running Alepha CLI commands (build, dev, etc.), use these environment variables for verbose output:
- `LOG_FORMAT=pretty` - Human-readable colored log output
- `LOG_LEVEL=trace` - Maximum verbosity (trace, debug, info, warn, error)

Example:
```bash
LOG_FORMAT=pretty LOG_LEVEL=trace yarn w @alepha/devtools build
```

## Development Commands

### Core Commands
- `yarn v` or `yarn alepha verify` - Full verification pipeline: clean, lint, typecheck, test, check-dependencies, build, clean
- `yarn clean` or `yarn alepha clean` - Remove all generated files and node_modules
- `yarn build` - Build all workspace packages using `tsdown`
- `yarn test` - Run all tests using Vitest
- `yarn lint` - Format and lint using Biome (with `--fix` flag)
- `yarn typecheck` - TypeScript type checking (`tsc --noEmit`)
- `yarn check-dependencies` - Check for unused dependencies using depcheck

### Workspace Commands
- `yarn w <workspace> <command>` - Run commands in specific workspace
  - Examples:
    - `yarn w alepha test` - Run tests for alepha package
    - `yarn w @alepha/ui typecheck` - Type check @alepha/ui package
    - `yarn w @alepha/devtools build` - Build @alepha/devtools package

## Architecture

### Framework Core
- Uses primitive-based architecture with `$` prefixed primitives (`$action`, `$entity`, `$repository`, etc.)
- Dependency injection container in `alepha`
- Convention-driven with minimal configuration
- Documentation: https://alepha.dev/llms.txt

### Package Organization

Alepha uses a hybrid monorepo structure:

**Unified Package (`alepha`)**
- The `alepha` package exports 50+ framework sub-modules
- Sub-modules can be imported as `alepha/module-name/submodule-name` (e.g., `alepha/server`, `alepha/security`, `alepha/api/users`)
- Provides unified dependency management and consistent versioning
- Located in `packages/alepha/src/` with each sub-module as a directory

**Specialized Packages**
- `@alepha/ui` - Shared shadcn-based UI for monorepo apps (sourced from `@alepha/ui-registry`)
- `@alepha/ui-registry` - shadcn registry source (blocks distributed via `https://alepha.dev/r/*`)
- `@alepha/devtools` - Development tools and inspection UI
- `@alepha/bucket-s3` - S3-compatible Blob Storage backend
- `@alepha/payments-stripe` - Stripe payments backend
- `@alepha/protobuf` - Protocol Buffers support

### Testing

#### Test Configuration
- Uses **Vitest** with global test environment
- Coverage tracking for `packages/*/src/**/*.ts(x)`
- Test databases and Azure storage emulator configuration included via `vitest.config.ts`
- Tests located in `__tests__/` directories within each package / module or as co-located `*.spec.ts` files

#### Test Environments
Two test environments are configured:
1. **Node.js tests** - `*.spec.{ts,tsx}` (excludes `*.browser.spec.*`)
2. **Browser tests (jsdom)** - `*.browser.spec.{ts,tsx}`
   - Use `.browser.spec.ts` or `.browser.spec.tsx` extension for browser tests
   - Automatically uses jsdom environment

#### Running Tests
- **All packages**: `yarn test`
- **Single package**: `yarn w alepha test`
- **Filtered tests**: `yarn w alepha vitest run <pattern>` (e.g., `yarn w alepha vitest run init.spec`)
- **With coverage**: `yarn vitest run --coverage`

#### Testing Patterns
- **Automatic Lifecycle**: `Alepha.create()` automatically handles start/stop in test environments
- **Service Substitution**: Use `Alepha.with()` for mocking dependencies (preferred over traditional mocking)
- **Standard Structure**: Follow Arrange-Act-Assert pattern with descriptive test names
- **Error Testing**: Use `expect().toThrow()` for sync errors, `expect().rejects.toThrowError()` for async
- **Shared Functions**: Create reusable test functions for testing multiple implementations

#### Important: Avoid vi.mock
**NEVER use `vi.mock()` or `vi.spyOn()`** - Alepha's DI system makes traditional mocking unnecessary and often problematic. Instead:

1. **Service Substitution** - Replace real services with test implementations:
```typescript
const alepha = Alepha.create()
  .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
  .with({ provide: ShellProvider, use: MemoryShellProvider });
```

2. **Memory Providers** - Use built-in memory implementations for I/O-bound services:
   - `MemoryFileSystemProvider` - In-memory file system with test assertions
   - `MemoryShellProvider` - In-memory shell command tracking
   - `MemoryQueueProvider` - In-memory job queue
   - `MemoryTopicProvider` - In-memory pub/sub
   - `MemoryLockProvider` - In-memory distributed locks
   - `MemorySmsProvider` - In-memory SMS tracking
   - `MemoryFileStorageProvider` - In-memory file storage (buckets)

3. **Test Assertion Helpers** - Memory providers include DX helpers:
```typescript
const fs = alepha.inject(MemoryFileSystemProvider);
expect(fs.wasWritten("/path/file.ts")).toBe(true);
expect(fs.wasWrittenMatching("/path/file.ts", /pattern/)).toBe(true);
expect(fs.wasRead("/path/file.ts")).toBe(true);
expect(fs.wasDeleted("/path/file.ts")).toBe(true);

const shell = alepha.inject(MemoryShellProvider);
expect(shell.wasCalled("yarn install")).toBe(true);
```

4. **TestProvider Pattern** - For unit testing protected methods, create a test subclass:
```typescript
class TestCliProvider extends CliProvider {
  public testParseFlags = this.parseFlags.bind(this);
  public testResolveCommand = this.resolveCommand.bind(this);
}
const cli = alepha.inject(TestCliProvider);
const result = cli.testParseFlags(["--verbose"], flagDefs);
```

5. **CLI Testing** - Use `CliProvider.run()` for lightweight command testing:
```typescript
const cli = alepha.inject(CliProvider);
const cmd = alepha.inject(InitCommand);
await cli.run(cmd.init, { argv: "--react --test", root: "/project" });
```

#### Common Test Patterns
```typescript
// Basic test structure
test("description", async ({ expect }) => {
  const alepha = Alepha.create();
  class TestApp { /* ... */ }
  const app = alepha.inject(TestApp);
  await alepha.start();

  const result = await app.method();
  expect(result).toBe(expected);
});

// Service substitution (preferred over vi.mock)
const alepha = Alepha.create().with({
  provide: BaseService,
  use: MockService,
});

// Testing with memory providers
const alepha = Alepha.create()
  .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
const fs = alepha.inject(MemoryFileSystemProvider);
await fs.writeFile("/test/file.txt", "content");
// ... run code that uses FileSystemProvider ...
expect(fs.wasWritten("/test/output.txt")).toBe(true);

// Browser tests
test("should work in browser", async ({ expect }) => {
  // This test will run in jsdom environment
  const element = document.createElement('div');
  expect(element).toBeDefined();
});
```

## Mandatory Requirements After Code Changes

**⚠️ REQUIRED - Must Run After Every Code Modification:**

After updating ANY code in this repository, you MUST execute:
```bash
yarn lint       # Linting - auto-fixes formatting and import order
yarn typecheck  # Type checking - catches TypeScript errors
yarn test       # Unit and integration tests - ensures functionality
```

These commands are **MANDATORY** and non-negotiable. Do not skip them under any circumstances.
- If `yarn typecheck` fails, fix all type errors before proceeding
- If `yarn test` fails, fix all test failures
- If `yarn lint` fails, fix all lint issues

For package-specific work, use:
```bash
yarn w @package-name typecheck && yarn w @package-name test
```

## Notes for AI Assistants

- **CRITICAL**: NEVER run `git commit`, `git add`, `git push`, or any git command that modifies history or the index. NEVER, under any circumstances, even if explicitly asked in the moment — the user's standing rule overrides one-off requests. The only allowed git command is `git mv` for renaming/moving files. Provide modified code and let the human review and commit.
- Update docs/1-guides/ if you change any public API or behavior (docs/3-reference is auto generated from source code)
- The framework heavily uses TypeScript generics and decorators (`$` prefix indicates a primitive)
- All async operations should use `Alepha.create()` and proper lifecycle management
- HTTP client (`HttpClient`) has built-in request deduplication and caching
- Browser tests must use `.browser.spec.ts` extension to run in jsdom
- React hooks follow the pattern: `use` + noun (useAction, useClient, etc.)
- Services use dependency injection via `$inject()` decorator
- Event names follow pattern: `namespace:action:status`
- **IMPORTANT**: NEVER use the `private` keyword in class members. Use `protected` instead for all access control
- **IMPORTANT**: NEVER use `vi.mock()` or `vi.spyOn()` - use Alepha's service substitution with `.with()` and Memory providers instead
- **IMPORTANT**: NEVER use single-line JSDoc comments. Always use multi-line format:
  ```typescript
  // Bad
  /** This is a single-line comment */

  // Good
  /**
   * This is a multi-line comment.
   */
  ```
- **Package imports**: All 50+ core modules can be imported from the `alepha` package (e.g., `import { } from "alepha/security"`)
- Always use "git mv" for renaming files to preserve git history
- Tests can be co-located with source code as `*.spec.ts` files (not just in `__tests__` directories)
