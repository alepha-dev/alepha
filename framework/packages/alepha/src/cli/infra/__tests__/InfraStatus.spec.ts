import { Alepha } from "alepha";
import { InfraOrchestrator } from "alepha/cli/infra-lib";
import { CliProvider } from "alepha/command";
import { describe, it } from "vitest";

import { InfraCommand } from "../commands/infra.ts";

/**
 * Answers for one environment without a config file, a host or a network:
 * what is under test is how `alepha infra status` prints the state, not how
 * the state is fetched.
 */
class FakeOrchestrator extends InfraOrchestrator {
  public serverless = false;

  public override async resolveEnvironment(): Promise<any> {
    return {
      config: { project: "my-app" },
      env: "production",
      descriptor: { adapter: { id: this.serverless ? "cloudflare" : "bay" } },
      adapter: { serverless: this.serverless },
    };
  }

  public override async status(): Promise<any> {
    return {
      config: {},
      state: {
        workers: [
          {
            name: "my-app/production",
            exists: true,
            version: "abcdef0123",
          },
        ],
        databases: [],
        buckets: [],
        kvNamespaces: [],
        queues: [],
        secrets: [],
      },
    };
  }
}

class TestInfraCommand extends InfraCommand {
  public readonly testStatus = this.status;

  protected override async resolveApp(): Promise<any> {
    return { entry: {}, resources: {} };
  }
}

describe("alepha infra status", () => {
  const run = async (serverless: boolean) => {
    const alepha = Alepha.create().with({
      provide: InfraOrchestrator,
      use: FakeOrchestrator,
    });
    alepha.inject(FakeOrchestrator).serverless = serverless;
    const cli = alepha.inject(CliProvider);
    const cmd = alepha.inject(TestInfraCommand);

    const writes: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as any;
    try {
      await cli.run(cmd.testStatus, {
        root: "/project",
        argv: "--env production",
      });
    } finally {
      process.stdout.write = original;
    }
    return writes.join("");
  };

  /**
   * A Bay app is a process on a server. Listing it under "Workers:" read as
   * a Cloudflare deploy (#Q3152).
   */
  it("lists a Bay app under Apps, not Workers", async ({ expect }) => {
    const out = await run(false);

    expect(out).toContain("Apps:");
    expect(out).not.toContain("Workers:");
    expect(out).toContain("my-app/production");
  });

  it("keeps Workers for a serverless deploy", async ({ expect }) => {
    const out = await run(true);

    expect(out).toContain("Workers:");
    expect(out).not.toContain("Apps:");
  });
});
