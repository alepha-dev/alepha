import { Alepha } from "alepha";
import { Runner } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { capacitorOptions } from "../atoms/capacitorOptions.ts";
import { AlephaCliCapacitorPlugin } from "../index.ts";
import { CapacitorOtaSetup } from "../services/CapacitorOtaSetup.ts";

const ROOT = "/app";

/**
 * What `alepha init --preset saas` writes that init --ota edits, plus the
 * capacitor({ ... }) the guide adds.
 */
const saas = {
  "package.json": JSON.stringify({ name: "app", dependencies: {} }),
  "alepha.config.ts": `import { capacitor } from "@alepha/capacitor/cli";
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  plugins: [
    capacitor({
      appId: "dev.example.app",
      appName: "App",
      scheme: "app",
    }),
  ],
});
`,
  "src/main.server.ts": `import { Alepha, run } from "alepha";

import { ApiModule } from "./api/index.ts";
import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(ApiModule);
alepha.with(WebModule);

run(alepha);
`,
  "src/main.browser.ts": `import { Alepha, run } from "alepha";

import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

alepha.with(WebModule);

run(alepha);
`,
  "src/web/index.ts": `import { AccountRouter } from "@alepha/ui/account";
import { AdminRouter } from "@alepha/ui/admin";
import { $module } from "alepha";

import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "app.web",
  services: [AppRouter, AccountRouter, AdminRouter],
});
`,
  ".gitignore": "node_modules\n",
  ".env.example": "APP_SECRET=\n",
};

const setup = async (files: Record<string, string> = saas) => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with(AlephaCliCapacitorPlugin);
  alepha.store.set(capacitorOptions, {
    appId: "dev.example.app",
    appName: "App",
    scheme: "app",
  });
  const fs = alepha.inject(MemoryFileSystemProvider);
  for (const [path, content] of Object.entries(files)) {
    await fs.writeFile(`${ROOT}/${path}`, content);
  }
  const setupService = alepha.inject(CapacitorOtaSetup);
  const runner = alepha.inject(Runner);
  const read = (path: string) => fs.readTextFile(`${ROOT}/${path}`);
  return {
    alepha,
    fs,
    shell: alepha.inject(MemoryShellProvider),
    read,
    run: () => setupService.run({ root: ROOT, run: runner.run }),
  };
};

describe("alepha capacitor init --ota", () => {
  it("wires the server, the device client, the admin and the keys", async ({
    expect,
  }) => {
    const { read, run, fs, shell } = await setup();
    await run();

    expect(shell.wasCalledMatching(/@capgo\/capacitor-updater@8\.52\.1/)).toBe(
      true,
    );
    expect(await read("alepha.config.ts")).toContain(
      'ota: { publicKey: "ota-public.pem" },',
    );
    const server = await read("src/main.server.ts");
    expect(server).toContain(
      'import { AlephaCapacitorOtaApi } from "@alepha/capacitor/ota-api";',
    );
    expect(server).toMatch(
      /alepha\.with\(WebModule\);\nalepha\.with\(AlephaCapacitorOtaApi\);/,
    );
    const browser = await read("src/main.browser.ts");
    // The device client after core, both before the app's modules.
    expect(browser).toMatch(
      /alepha\.with\(AlephaCapacitor\);\nalepha\.with\(AlephaCapacitorOta\);\nalepha\.with\(WebModule\);/,
    );
    expect(await read("src/web/index.ts")).toContain(
      "services: [AppRouter, AccountRouter, AdminRouter, OtaAdminRouter]",
    );
    expect(await read(".gitignore")).toContain("/.ota/");
    expect(await read(".env.example")).toContain("OTA_DOWNLOAD_SECRET=");

    const publicKey = await read("ota-public.pem");
    const privateKey = await read(".ota/signing-key.pem");
    expect(publicKey).toContain("BEGIN RSA PUBLIC KEY");
    expect(privateKey).toContain("BEGIN RSA PRIVATE KEY");
    expect((await fs.stat(`${ROOT}/.ota/signing-key.pem`)).mode).toBe(0o600);

    // The private key reaches nothing that ships or that git keeps.
    const native = await read("capacitor.config.ts");
    expect(native).toContain("allowManualBundleError: true");
    expect(native).not.toContain("PRIVATE");
    for (const path of [
      "alepha.config.ts",
      "src/main.server.ts",
      "src/main.browser.ts",
      ".env.example",
    ]) {
      expect(await read(path)).not.toContain("PRIVATE");
    }
  });

  it("links the updater into the native projects init already made", async ({
    expect,
  }) => {
    // Seen on a fresh app: without it, Package.swift gained the plugin only
    // at the next dev run, changing the tree under the developer.
    const { fs, run, shell } = await setup({
      ...saas,
      "ios/App/CapApp-SPM/Package.swift": "// swift",
    });
    await run();
    expect(shell.wasCalledMatching(/cap update ios/)).toBe(true);
    expect(shell.wasCalledMatching(/cap update android/)).toBe(false);
    expect(await fs.exists(`${ROOT}/android`)).toBe(false);
  });

  it("changes nothing on a second run, keys included", async ({ expect }) => {
    const { read, run } = await setup();
    await run();
    const before = {
      config: await read("alepha.config.ts"),
      server: await read("src/main.server.ts"),
      browser: await read("src/main.browser.ts"),
      web: await read("src/web/index.ts"),
      gitignore: await read(".gitignore"),
      env: await read(".env.example"),
      publicKey: await read("ota-public.pem"),
      privateKey: await read(".ota/signing-key.pem"),
    };
    await run();
    expect({
      config: await read("alepha.config.ts"),
      server: await read("src/main.server.ts"),
      browser: await read("src/main.browser.ts"),
      web: await read("src/web/index.ts"),
      gitignore: await read(".gitignore"),
      env: await read(".env.example"),
      publicKey: await read("ota-public.pem"),
      privateKey: await read(".ota/signing-key.pem"),
    }).toEqual(before);
  });

  it("refuses a custom entry before writing anything, with the patch", async ({
    expect,
  }) => {
    const { read, run, fs } = await setup({
      ...saas,
      "src/main.server.ts": "export default createMyServer();\n",
    });
    await expect(run()).rejects.toThrow(
      /src\/main\.server\.ts: not an entry built as[\s\S]*alepha\.with\(AlephaCapacitorOtaApi\);/,
    );
    expect(await read("alepha.config.ts")).toBe(saas["alepha.config.ts"]);
    expect(await fs.exists(`${ROOT}/ota-public.pem`)).toBe(false);
  });

  it("never mints a new pair over an existing private key", async ({
    expect,
  }) => {
    const { run } = await setup({ ...saas, ".ota/signing-key.pem": "kept" });
    await expect(run()).rejects.toThrow(/restore the public key from git/);
  });

  it("leaves an app without an admin with the API only", async ({ expect }) => {
    const { read, run } = await setup({
      ...saas,
      "src/web/index.ts": saas["src/web/index.ts"].replace(", AdminRouter", ""),
    });
    await run();
    expect(await read("src/web/index.ts")).not.toContain("OtaAdminRouter");
    expect(await read("src/main.server.ts")).toContain("AlephaCapacitorOtaApi");
  });
});
