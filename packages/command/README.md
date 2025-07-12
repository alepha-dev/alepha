# @alepha/command

Alepha command module - provides CLI command parsing and runner utilities.

## Features

- Parse command line arguments with flags, options, and positional arguments
- Support for both long (`--flag`) and short (`-f`) flag formats
- Flag chaining (`-abc` for multiple boolean flags)
- Type-safe argument parsing with TypeBox schema validation
- Default values and required flags
- Command matching and execution
- Automatic command naming from key member names

## Usage

```typescript
import { Alepha, t } from "@alepha/core";
import { $command, AlephaCommand } from "@alepha/command";

class CLI {
  // Command name automatically becomes "build" from the key member name
  build = $command({
    description: "Build the project",
    flags: t.object({
      output: t.string({ description: "Output directory" }),
      verbose: t.boolean({ default: false, description: "Verbose output" }),
      watch: t.optional(t.boolean({ description: "Watch for changes" })),
    }),
    handler: async (args, rawArgs) => {
      console.log("Building with options:", args);
      if (args.verbose) {
        console.log("Verbose mode enabled");
      }
      // Build logic here
    },
  });

  // Explicit command name override
  deploy = $command({
    name: "deploy-prod",
    flags: t.object({
      env: t.string(),
      replicas: t.number({ default: 1 }),
    }),
    handler: async (args, rawArgs) => {
      console.log(`Deploying to ${args.env} with ${args.replicas} replicas`);
    },
  });
}

const alepha = Alepha.create().with(AlephaCommand);
const cli = alepha.get(CLI);

await alepha.start();

// Parse and execute: build --output dist --verbose
if (cli.build.matches(process.argv.slice(2))) {
  await cli.build.run(process.argv.slice(2));
}
```

## Command Parsing Examples

```typescript
// Parse: build --output dist --verbose
const parsed = command.parse(["build", "--output", "dist", "--verbose"]);
// Result: { command: "build", flags: { output: "dist", verbose: true }, positional: ["build"], raw: [...] }

// Parse: build -o dist -v
const parsed = command.parse(["build", "-o", "dist", "-v"]);
// Result: { command: "build", flags: { output: "dist", verbose: true }, positional: ["build"], raw: [...] }

// Parse: build --output=dist
const parsed = command.parse(["build", "--output=dist"]);
// Result: { command: "build", flags: { output: "dist" }, positional: ["build"], raw: [...] }

// Parse with chained flags: build -vw
const parsed = command.parse(["build", "-vw"]);
// Result: { command: "build", flags: { verbose: true, watch: true }, positional: ["build"], raw: [...] }
```

## API

### $command(options)

Creates a command descriptor.

**Options:**
- `name?: string` - Command name to match (defaults to key member name)
- `description?: string` - Command description
- `flags?: TObject` - TypeBox object schema defining all flags
- `handler: (args, rawArgs) => Promise<void> | void` - Command handler

**Flag Definition using TypeBox:**
Use TypeBox schemas to define flags with their types, defaults, and validation:
- `t.string()` - String flag
- `t.number()` - Number flag  
- `t.boolean()` - Boolean flag
- `t.optional(schema)` - Optional flag
- `schema({ default: value })` - Flag with default value

**Returns:**
- `parse(args: string[]): ParsedCommand` - Parse command arguments
- `run(args: string[]): Promise<void>` - Execute command
- `matches(args: string[]): boolean` - Check if command matches arguments

## Examples

### Simple Command
```typescript
class App {
  hello = $command({
    flags: t.object({
      name: t.string({ default: "World" }),
    }),
    handler: (args) => {
      console.log(`Hello, ${args.name}!`);
    },
  });
}
```

### Complex Command with Multiple Flags
```typescript
class App {
  server = $command({
    flags: t.object({
      port: t.number({ default: 3000 }),
      host: t.string({ default: "localhost" }),
      ssl: t.optional(t.boolean()),
      config: t.string(), // Required by default
    }),
    handler: async (args) => {
      console.log(`Starting server on ${args.host}:${args.port}`);
      if (args.ssl) {
        console.log("SSL enabled");
      }
      // Server logic here
    },
  });
}

// Usage examples for the above:
// hello --name Claude        -> { name: "Claude" }
// hello                      -> { name: "World" } (default)
// server --config app.json   -> { port: 3000, host: "localhost", config: "app.json" }
// server --port 8080 --ssl --config prod.json -> { port: 8080, host: "localhost", ssl: true, config: "prod.json" }
```

### Advanced TypeBox Features
```typescript
class App {
  deploy = $command({
    flags: t.object({
      // String with constraints
      env: t.string({ enum: ["dev", "staging", "prod"] }),
      // Number with min/max
      replicas: t.number({ minimum: 1, maximum: 10, default: 1 }),
      // Optional array
      tags: t.optional(t.array(t.string())),
      // Boolean with description
      dryRun: t.boolean({ default: false, description: "Preview changes without applying" }),
    }),
    handler: async (args) => {
      console.log(`Deploying to ${args.env} with ${args.replicas} replicas`);
      if (args.dryRun) {
        console.log("DRY RUN - no actual deployment");
      }
    },
  });
}
```