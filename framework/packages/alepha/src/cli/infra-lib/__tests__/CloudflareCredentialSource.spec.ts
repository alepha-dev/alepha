import { Alepha } from "alepha";
import type { RunnerMethod } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
  type ShellRunOptions,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import type { InfraContext } from "../adapters/InfraAdapter.ts";
import { CloudflareCredentialSource } from "../services/CloudflareCredentialSource.ts";

/**
 * The machine, answered by the spec: its environment, whether a person is at
 * the terminal, and the accounts `/accounts` would list.
 */
class TestCredentialSource extends CloudflareCredentialSource {
  public static env: Record<string, string> = {};
  public static interactive = true;
  public static accounts: Array<{ id: string; name: string }> = [
    { id: "acc-only", name: "Only" },
  ];
  public static accountLookups = 0;

  protected override readEnv(key: string): string | undefined {
    return TestCredentialSource.env[key];
  }

  protected override isInteractive(): boolean {
    return TestCredentialSource.interactive;
  }

  protected override async listAccounts(): Promise<
    Array<{ id: string; name: string }>
  > {
    TestCredentialSource.accountLookups++;
    return TestCredentialSource.accounts;
  }
}

/**
 * A shell where `wrangler login` is what makes `wrangler auth token` answer,
 * the way it does on a machine.
 */
class LoginShell extends MemoryShellProvider {
  public override async run(
    command: string | string[],
    options: ShellRunOptions = {},
  ): Promise<string> {
    const answer = await super.run(command, options);
    if (String(command).startsWith("wrangler login")) {
      this.outputs.set(
        "wrangler auth token --json",
        JSON.stringify({ type: "oauth", token: "fresh-token" }),
      );
    }
    return answer;
  }
}

const run: RunnerMethod = (async (task: { handler: () => Promise<unknown> }) =>
  await task.handler()) as unknown as RunnerMethod;

const setup = async (
  options: {
    env?: Record<string, string>;
    interactive?: boolean;
    wranglerInstalled?: boolean;
  } = {},
) => {
  TestCredentialSource.env = options.env ?? {};
  TestCredentialSource.interactive = options.interactive ?? true;
  TestCredentialSource.accounts = [{ id: "acc-only", name: "Only" }];
  TestCredentialSource.accountLookups = 0;

  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: LoginShell })
    .with({ provide: CloudflareCredentialSource, use: TestCredentialSource });
  const fs = alepha.inject(MemoryFileSystemProvider);
  await fs.writeFile(
    "/app/package.json",
    JSON.stringify(
      options.wranglerInstalled === false
        ? { name: "app" }
        : { name: "app", devDependencies: { wrangler: "^4.140.0" } },
    ),
  );
  await fs.writeFile("/app/package-lock.json", "{}");

  return {
    alepha,
    shell: alepha.inject(LoginShell),
    source: alepha.inject(CloudflareCredentialSource),
  };
};

describe("CloudflareCredentialSource", () => {
  describe("token", () => {
    it("uses CLOUDFLARE_API_TOKEN as is, and never calls or installs wrangler", async () => {
      const { shell, source } = await setup({
        env: { CLOUDFLARE_API_TOKEN: "env-token" },
        wranglerInstalled: false,
      });

      const answer = await source.resolve({ root: "/app", accountId: "acc" });

      expect(answer).toEqual({
        credential: { apiToken: "env-token", accountId: "acc" },
        origin: "env",
      });
      // Not even the install: CI with a token must leave package.json alone.
      expect(shell.calls).toEqual([]);
    });

    it("reads the wrangler token once per run, whatever the number of entry points", async () => {
      const { shell, source } = await setup();
      shell.outputs.set(
        "wrangler auth token --json",
        JSON.stringify({ type: "oauth", token: "wrangler-token" }),
      );

      const first = await source.resolve({ root: "/app" });
      const second = await source.resolve({ root: "/app" });

      expect(first.origin).toBe("wrangler");
      expect(second.credential.apiToken).toBe("wrangler-token");
      expect(shell.getCallsMatching(/^wrangler auth token/)).toHaveLength(1);
      expect(shell.wasCalledMatching(/^wrangler login/)).toBe(false);
    });

    it("starts wrangler login on a TTY when wrangler has no token, then reads the fresh one", async () => {
      const { shell, source } = await setup();

      const answer = await source.resolve({ root: "/app" });

      expect(answer.origin).toBe("login");
      expect(answer.credential.apiToken).toBe("fresh-token");
      expect(shell.calls.map((it) => it.command)).toEqual([
        "wrangler auth token --json",
        "wrangler login",
        "wrangler auth token --json",
      ]);
    });

    it("installs wrangler first on a TTY, so the login has something to run", async () => {
      const { shell, source } = await setup({ wranglerInstalled: false });

      await source.resolve({ root: "/app" });

      expect(shell.calls[0].command).toBe("npm install --save-dev wrangler");
    });

    it("refuses off a TTY with no token, naming CLOUDFLARE_API_TOKEN instead of opening a login", async () => {
      const { shell, source } = await setup({
        interactive: false,
        wranglerInstalled: false,
      });

      await expect(source.resolve({ root: "/app" })).rejects.toThrow(
        /CLOUDFLARE_API_TOKEN/,
      );
      expect(shell.wasCalledMatching(/^wrangler login/)).toBe(false);
      expect(shell.wasCalledMatching(/install/)).toBe(false);
    });

    it("refuses a global API key by name: it is not a bearer token", async () => {
      const { shell, source } = await setup();
      shell.outputs.set(
        "wrangler auth token --json",
        JSON.stringify({ type: "api_key", key: "k", email: "a@b.c" }),
      );

      await expect(source.resolve({ root: "/app" })).rejects.toThrow(
        /global API key/,
      );
    });
  });

  describe("account id", () => {
    it("prefers the option, then CLOUDFLARE_ACCOUNT_ID, then the token's only account", async () => {
      const env = { CLOUDFLARE_API_TOKEN: "t" };

      const option = await setup({
        env: { ...env, CLOUDFLARE_ACCOUNT_ID: "from-env" },
      });
      expect(
        (
          await option.source.resolve({
            root: "/app",
            accountId: "from-option",
          })
        ).credential.accountId,
      ).toBe("from-option");

      const fromEnv = await setup({
        env: { ...env, CLOUDFLARE_ACCOUNT_ID: "from-env" },
      });
      expect(
        (await fromEnv.source.resolve({ root: "/app" })).credential.accountId,
      ).toBe("from-env");

      const lookedUp = await setup({ env });
      expect(
        (await lookedUp.source.resolve({ root: "/app" })).credential.accountId,
      ).toBe("acc-only");
      expect(TestCredentialSource.accountLookups).toBe(1);
    });

    it("refuses to pick between several accounts, and lists them", async () => {
      const { source } = await setup({ env: { CLOUDFLARE_API_TOKEN: "t" } });
      TestCredentialSource.accounts = [
        { id: "a1", name: "One" },
        { id: "a2", name: "Two" },
      ];

      await expect(source.resolve({ root: "/app" })).rejects.toThrow(
        /access to 2 accounts[\s\S]*a1[\s\S]*a2/,
      );
    });

    it("carries the jurisdiction into the credential", async () => {
      const { source } = await setup({ env: { CLOUDFLARE_API_TOKEN: "t" } });

      const answer = await source.resolve({
        root: "/app",
        accountId: "acc",
        jurisdiction: "eu",
      });

      expect(answer.credential.jurisdiction).toBe("eu");
    });
  });

  describe("CloudflareAdapter", () => {
    const context = (): InfraContext<any> =>
      ({
        env: "production",
        root: "/app",
        options: {},
      }) as InfraContext<any>;

    it("authenticates with an environment token and never touches wrangler", async () => {
      const { alepha, shell } = await setup({
        env: { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc" },
        wranglerInstalled: false,
      });

      await alepha.inject(CloudflareAdapter).authenticate(context(), run);

      expect(shell.calls).toEqual([]);
    });

    it("passes --device through to wrangler login", async () => {
      const { alepha, shell } = await setup();

      await alepha
        .inject(CloudflareAdapter)
        .login(context(), run, { device: true });

      expect(shell.wasCalled("wrangler login --device")).toBe(true);
    });
  });
});
