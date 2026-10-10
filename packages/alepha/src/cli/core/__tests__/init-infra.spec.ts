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
import { InfraConfigEditor } from "../services/InfraConfigEditor.ts";

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

const refusedConfigs = [
  `${header}export default defineConfig({ plugins: plugins });`,
  `${header}export default defineConfig({ plugins: [...plugins] });`,
  `${header}export default defineConfig({ ...options });`,
  `${header}export default defineConfig({ [key]: [] });`,
  `${header}export default defineConfig({ plugins: [infra(options)] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments })] });`,
  `${header}export default defineConfig({ plugins: [infra({ ...options, environments: { production: cloudflare() } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ name: name, environments: { production: cloudflare() } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: cloudflare({ domain: process.env.DOMAIN }) } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: cloudflare({ ...options }) } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: bay({ host: "deploy@bay.example.com" }) } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: lore() } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { preview: cloudflare() } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: descriptor } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: cloudflare() } }), infra({ environments: { production: cloudflare() } })] });`,
  `${header}export default defineConfig({ plugins: [() => infra({ environments: { production: cloudflare() } })] });`,
  `${header}const configured = infra({ environments: { production: cloudflare() } }); export default defineConfig({ plugins: [configured] });`,
  `${header}const register = () => infra({ environments: { production: cloudflare() } }); export default defineConfig({ plugins: [register] });`,
  `${header}export default config;`,
  `${header}export default defineConfig(makeConfig());`,
  `import { defineConfig } from "alepha/cli/config"; import { platform, cloudflare } from "alepha/cli/platform"; export default defineConfig({ plugins: [platform({ environments: { production: cloudflare() } })] });`,
  `import { defineConfig } from "alepha/cli/config"; import { AlephaCliInfraPlugin } from "alepha/cli/infra"; export default defineConfig({ services: [AlephaCliInfraPlugin] });`,
  `import { defineConfig } from "alepha/cli/config"; import { AlephaInfraLibPlugin } from "alepha/cli/infra-lib"; export default defineConfig({ services: [AlephaInfraLibPlugin] });`,
  `import { defineConfig } from "alepha/cli/config"; import * as i from "alepha/cli/infra"; export default defineConfig({ plugins: [i.infra({ environments: { production: i.cloudflare() } })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: cloudflare() }, environments: {} })] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: cloudflare() } })], plugins: [] });`,
  `${header}export default defineConfig({ plugins: [infra({ environments: { production: cloudflare("invalid") } })] });`,
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

  for (const [index, config] of refusedConfigs.entries()) {
    it(`preflights unsupported existing config ${index + 1} before any scaffold writes/install`, async ({
      expect,
    }) => {
      const { cli, command, fs, shell } = await setup(config);
      const writes = fs.writeFileCalls.length;
      await expect(
        cli.run(command.init, { root: "/project", argv: "--infra cf" }),
      ).rejects.toThrow(
        /Cannot safely add Cloudflare[\s\S]*defineConfig[\s\S]*production: cloudflare/,
      );
      expect(fs.writeFileCalls).toHaveLength(writes);
      expect(shell.calls).toHaveLength(0);
      expect(fs.getFileContent("/project/alepha.config.ts")).toBe(config);
    });
  }

  it("preserves canonical configuration exactly on rerun", async ({
    expect,
  }) => {
    const { cli, command, fs } = await setup(canonical);
    await cli.run(command.init, { root: "/project", argv: "--infra cf" });
    await cli.run(command.init, {
      root: "/project",
      argv: "--infra cloudflare",
    });
    expect(fs.getFileContent("/project/alepha.config.ts")).toBe(canonical);
    expect(
      fs.writeFileCalls.filter(
        (call) => call.path === "/project/alepha.config.ts",
      ),
    ).toHaveLength(1);
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

describe("bounded infrastructure config edits", () => {
  const editor = () => Alepha.create().inject(InfraConfigEditor);

  it("preserves aliases, import specifiers, comments, options and unrelated plugins", ({
    expect,
  }) => {
    const source = `// 🌲 existing options
import { defineConfig as config } from "alepha/cli/config";
import { cloudflare as cf, bay } from "alepha/cli/infra";
import { App } from "./App.ts";
export default config({
  services: [App],
  // This option is unrelated.
  dev: { port: 3300 },
  plugins: [otherPlugin({ dynamic: process.env.OPTION }) /* Keep this comment */]
});`;
    const result = editor().addCloudflare(source);
    expect(result).toContain("cloudflare as cf, bay");
    expect(result).toContain("// 🌲 existing options");
    expect(result).toContain("services: [App]");
    expect(result).toContain("dev: { port: 3300 }");
    expect(result).toContain(
      "otherPlugin({ dynamic: process.env.OPTION }), /* Keep this comment */",
    );
    expect(result).toContain("production: cf()");
    expect(editor().addCloudflare(result)).toBe(result);
  });

  it("adds a missing plugins property without changing existing fields", ({
    expect,
  }) => {
    const source = `import { defineConfig } from "alepha/cli/config";
export default defineConfig({ services: [Api, Web] // Keep the services
});`;
    const result = editor().addCloudflare(source);
    expect(result).toContain("services: [Api, Web], // Keep the services");
    expect(result).toContain(
      "plugins: [infra({ environments: { production: cloudflare() } })]",
    );
    expect(editor().addCloudflare(result)).toBe(result);
  });

  it("preserves an unrelated services shorthand", ({ expect }) => {
    const source = `import { defineConfig } from "alepha/cli/config";
const services = [Api, Web];
export default defineConfig({ services, plugins: [] });`;
    const result = editor().addCloudflare(source);
    expect(result).toContain("services, plugins: [");
    expect(editor().addCloudflare(result)).toBe(result);
  });

  it("preserves canonical helper/factory aliases across split imports", ({
    expect,
  }) => {
    const source = `import { defineConfig as config } from "alepha/cli/config";
import { infra as deployConfig } from "alepha/cli/infra";
import { cloudflare as cf } from "alepha/cli/infra";
export default config({ plugins: [deployConfig({ environments: { production: cf() } })] });`;
    expect(editor().addCloudflare(source)).toBe(source);
  });

  it("detects duplicate registrations even when each uses a different alias", ({
    expect,
  }) => {
    const source = `import { defineConfig } from "alepha/cli/config";
import { infra as a, cloudflare } from "alepha/cli/infra";
import { infra as b } from "alepha/cli/infra";
export default defineConfig({ plugins: [a({ environments: { production: cloudflare() } }), b({ environments: { production: cloudflare() } })] });`;
    expect(() => editor().addCloudflare(source)).toThrow(
      /multiple infra registrations/,
    );
  });

  it("keeps a factory imported from the shared library and adds only the helper", ({
    expect,
  }) => {
    const source = `import { defineConfig } from "alepha/cli/config";
import { cloudflare as cf } from "alepha/cli/infra-lib";
export default defineConfig({ plugins: [] });`;
    const result = editor().addCloudflare(source);
    expect(result).toContain('import { infra } from "alepha/cli/infra";');
    expect(result).toContain("production: cf()");
    expect(editor().addCloudflare(result)).toBe(result);
  });

  it("uses fresh aliases when unrelated bindings occupy helper names", ({
    expect,
  }) => {
    const source = `import { defineConfig } from "alepha/cli/config";
import { infra, cloudflare } from "./other.ts";
export default defineConfig({ plugins: [infra()] });`;
    const result = editor().addCloudflare(source);
    expect(result).toContain(
      "infra as alephaInfra, cloudflare as alephaCloudflare",
    );
    expect(result).toContain("production: alephaCloudflare()");
    expect(editor().addCloudflare(result)).toBe(result);
  });
});
