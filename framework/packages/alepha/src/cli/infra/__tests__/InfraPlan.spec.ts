import { Alepha } from "alepha";
import { cloudflare, infraOptions } from "alepha/cli/infra-lib";
import { CliProvider } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { InfraCommand } from "../commands/infra.ts";

/**
 * An app with a cache and a job queue, answered without booting one: what is
 * under test is the names `alepha infra plan` prints for them.
 */
class TestInfraCommand extends InfraCommand {
  public readonly testPlan = this.plan;

  protected override async resolveApp(): Promise<any> {
    return {
      entry: {},
      resources: {
        hasDatabase: false,
        hasBucket: false,
        hasAnalytics: false,
        hasKV: true,
        hasQueue: true,
        hasCron: false,
      },
    };
  }
}

describe("alepha infra plan", () => {
  const plan = async (options: Parameters<typeof cloudflare>[0]) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    alepha.set(infraOptions, {
      name: "my-app",
      environments: { production: cloudflare(options) },
    } as any);
    const cli = alepha.inject(CliProvider);
    const cmd = alepha.inject(TestInfraCommand);

    const writes: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as any;
    try {
      await cli.run(cmd.testPlan, {
        root: "/project",
        argv: "--env production --json",
      });
    } finally {
      process.stdout.write = original;
    }
    return JSON.parse(writes.join("")) as {
      resources: Array<{ label: string; value: string }>;
    };
  };

  it("names the KV namespace and the queue as the deploy creates them under a jurisdiction", async ({
    expect,
  }) => {
    const out = await plan({ jurisdiction: "eu" });

    expect(out.resources).toContainEqual({
      label: "KV",
      value: "my-app-production-eu",
    });
    expect(out.resources).toContainEqual({
      label: "Queue",
      value: "my-app-production-eu",
    });
  });

  it("leaves both names bare without a jurisdiction", async ({ expect }) => {
    const out = await plan({});

    expect(out.resources).toContainEqual({
      label: "KV",
      value: "my-app-production",
    });
    expect(out.resources).toContainEqual({
      label: "Queue",
      value: "my-app-production",
    });
  });
});
