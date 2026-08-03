import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";
import { LoreAdapter } from "../adapters/LoreAdapter.ts";
import type { PlatformContext } from "../adapters/PlatformAdapter.ts";

/**
 * Exposes what the adapter keeps protected.
 *
 * The three things under test here all run before a single byte moves — the
 * credential check, the campaign check and the release name — which is exactly
 * why they are worth pinning cheaply. Everything past them needs a live sink
 * and belongs in the e2e.
 */
class TestLoreAdapter extends LoreAdapter {
  public testCampaignId = this.campaignId.bind(this);
  public testApiKey = this.apiKey.bind(this);
  public testEndpoint = this.endpoint.bind(this);
  public testVersion = this.version.bind(this);
}

const contextFor = (envConfig: Record<string, unknown>): PlatformContext =>
  ({
    project: "lindocara-main",
    env: "production",
    envConfig,
    root: "/tmp/project",
  }) as unknown as PlatformContext;

describe("LoreAdapter", () => {
  const setup = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const adapter = alepha.inject(TestLoreAdapter);
    await alepha.start();
    return { adapter };
  };

  it("refuses to deploy without a credential, and names where to get one", async ({
    expect,
  }) => {
    const { adapter } = await setup();
    const previous = process.env.LORE_API_KEY;
    process.env.LORE_API_KEY = undefined as unknown as string;
    delete process.env.LORE_API_KEY;

    try {
      expect(() => adapter.testApiKey()).toThrow(/LORE_API_KEY/);
    } finally {
      if (previous !== undefined) {
        process.env.LORE_API_KEY = previous;
      }
    }
  });

  it("refuses a config with no campaign rather than guessing one", async ({
    expect,
  }) => {
    const { adapter } = await setup();

    // Guessing from the project name would silently deploy into whichever
    // campaign happened to match — two namespaces that have no relationship.
    expect(() =>
      adapter.testCampaignId(contextFor({ adapter: "lore" })),
    ).toThrow(/campaignId/);
  });

  it("falls back to the public instance and trims a trailing slash", async ({
    expect,
  }) => {
    const { adapter } = await setup();

    expect(adapter.testEndpoint(contextFor({ adapter: "lore" }))).toBe(
      "https://lore.alepha.dev",
    );
    expect(
      adapter.testEndpoint(
        contextFor({ adapter: "lore", endpoint: "https://lore.test/" }),
      ),
    ).toBe("https://lore.test");
  });

  it("names a release the way Bay names a release directory", async ({
    expect,
  }) => {
    // The format is a contract with the supervisor: a release in Lore and a
    // release on disk have to be the same string, or every comparison between
    // them becomes a correlation problem.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with({
      provide: DateTimeProvider,
      use: FixedClock,
    });
    const adapter = alepha.inject(TestLoreAdapter);
    await alepha.start();

    expect(adapter.testVersion()).toBe("2026-08-03-140506");
  });
});

/**
 * A clock stopped at a known instant.
 *
 * Substituted rather than mocked — the container is what makes this
 * unnecessary to fake, and a stopped clock is the only way to assert the exact
 * string instead of the shape of it.
 */
class FixedClock extends DateTimeProvider {
  public override nowMillis(): number {
    return Date.parse("2026-08-03T14:05:06.789Z");
  }
}
