import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { InitCommand } from "../commands/init.ts";

const setup = async (config?: string) => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider });
  const fs = alepha.inject(MemoryFileSystemProvider);
  await fs.writeFile("/project/package.json", JSON.stringify({ name: "demo" }));
  if (config !== undefined)
    await fs.writeFile("/project/alepha.config.ts", config);
  return {
    alepha,
    fs,
    cli: alepha.inject(CliProvider),
    command: alepha.inject(InitCommand),
    shell: alepha.inject(MemoryShellProvider),
  };
};

const header = `import { defineConfig } from "alepha/cli/config";
import { cloudflare, bay, infra } from "alepha/cli/infra";
`;
const canonical = `${header}export default defineConfig({
  services: [Api, Web],
  plugins: [otherPlugin(), infra({ name: "custom", project: "org", default: "preview", secrets: { keys: ["TOKEN"] }, environments: {
    production: cloudflare({ domain: "app.example.com", jurisdiction: "eu" }),
    preview: bay({ host: "deploy@bay.example.com" }),
  } })],
});`;

const existingConfigs = [
  canonical,
  `${header}export default defineConfig({ plugins: [] });`,
  `${header}export default defineConfig(makeConfig());`,
  `${header}export default defineConfig({`,
];

describe("init --infra", () => {
  for (const preset of ["default", "saas"]) {
    for (const flag of [
      "--infra cf",
      "--infra=cf",
      "--infra cloudflare",
      "--infra=cloudflare",
    ]) {
      it(`generates active production infrastructure for ${preset} with ${flag}`, async ({
        expect,
      }) => {
        const { cli, command, fs, shell } = await setup();
        await cli.run(command.init, {
          root: "/project",
          argv: `--preset ${preset} ${flag}`,
        });
        const config = fs.getFileContent("/project/alepha.config.ts")!;
        expect(config).toContain(
          'import { cloudflare, infra } from "alepha/cli/infra";',
        );
        expect(config).not.toContain("// import { cloudflare, infra }");
        expect(config).toContain("production: cloudflare(),");
        expect(config).not.toContain("preview: cloudflare()");
        expect(config).not.toMatch(/^\s*(?:name|project|default|runtime):/m);
        expect(
          shell.calls.some((call) =>
            /wrangler|alepha deploy|alepha infra/.test(call.command),
          ),
        ).toBe(false);
      });
    }
  }

  it("keeps infrastructure opt-in when the flag is omitted", async ({
    expect,
  }) => {
    const { cli, command, fs } = await setup();
    await cli.run(command.init, { root: "/project" });
    expect(fs.getFileContent("/project/alepha.config.ts")).toContain(
      "// import { cloudflare, infra }",
    );
  });

  for (const argv of [
    "--infra bay",
    "--infra=unknown",
    "--infra",
    "--platform cf",
    "--deploy cf",
  ]) {
    it(`refuses ${argv} before writes/install`, async ({ expect }) => {
      const { cli, command, fs, shell } = await setup();
      const writes = fs.writeFileCalls.length;
      await expect(
        cli.run(command.init, { root: "/project", argv }),
      ).rejects.toThrow();
      expect(fs.writeFileCalls).toHaveLength(writes);
      expect(shell.calls).toHaveLength(0);
    });
  }

  for (const [index, config] of existingConfigs.entries()) {
    it(`refuses existing config ${index + 1} before any scaffold writes/install`, async ({
      expect,
    }) => {
      const { cli, command, fs, shell } = await setup(config);
      const writes = fs.writeFileCalls.length;
      await expect(
        cli.run(command.init, { root: "/project", argv: "--infra cf" }),
      ).rejects.toThrow(
        /alepha\.config\.ts already exists[\s\S]*defineConfig[\s\S]*production: cloudflare[\s\S]*--force/,
      );
      expect(fs.writeFileCalls).toHaveLength(writes);
      expect(shell.calls).toHaveLength(0);
      expect(fs.getFileContent("/project/alepha.config.ts")).toBe(config);
    });
  }

  it("leaves an existing config alone when the flag is omitted", async ({
    expect,
  }) => {
    const { cli, command, fs } = await setup(canonical);
    await cli.run(command.init, { root: "/project" });
    expect(fs.getFileContent("/project/alepha.config.ts")).toBe(canonical);
  });

  it("keeps named-path guards and broad force while preserving .env", async ({
    expect,
  }) => {
    const { cli, command, fs } = await setup(canonical);
    await fs.writeFile("/project/.env", "TOKEN=keep-me\n");
    await expect(
      cli.run(command.init, { root: "/", argv: "project --infra cf" }),
    ).rejects.toThrow(/not empty/);
    await cli.run(command.init, {
      root: "/",
      argv: "project --infra cf --preset saas --force",
    });
    expect(fs.getFileContent("/project/.env")).toBe("TOKEN=keep-me\n");
    expect(fs.getFileContent("/project/alepha.config.ts")).toContain(
      "production: cloudflare(),",
    );
    expect(fs.getFileContent("/project/alepha.config.ts")).not.toContain(
      'domain: "app.example.com"',
    );
  });
});
