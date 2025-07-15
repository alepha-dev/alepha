## Alepha Command

Build powerful, type-safe command-line interfaces for your application.

## Usage

```typescript
import { run, t } from "alepha";
import { $command } from "alepha/command";

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

run(CLI);
```
