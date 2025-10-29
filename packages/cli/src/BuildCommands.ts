import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $command, CliProvider } from "@alepha/command";
import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { getServerEntry } from "@alepha/vite";
import { exec } from "./exec.ts";

export class BuildCommands {
  log = $logger();
  cli = $inject(CliProvider);

  dev = $command({
    name: "dev",
    description: "Run the project in development mode",
    handler: async () => {
      const root = process.cwd();
      try {
        await access(join(root, "index.html"));
      } catch {
        const entry = await getServerEntry(root);
        await exec(`tsx watch ${entry}`);
        return;
      }

      const viteConfigPath = await this.viteConfigPath();
      await exec(`vite -c=${viteConfigPath}`);
    },
  });

  build = $command({
    name: "build",
    description: "Build the project for production",
    flags: t.object({
      lib: t.optional(t.boolean()),
      config: t.optional(t.text({ aliases: ["c"] })),
    }),
    handler: async ({ flags }) => {
      if (flags.lib) {
        await exec(`tsdown${flags.config ? ` -c=${flags.config}` : ""}`);
        return;
      }

      const viteConfigPath = await this.viteConfigPath();
      await exec(`vite build -c=${viteConfigPath}`);
    },
  });

  clean = $command({
    name: "clean",
    description: "Clean the project",
    handler: async ({ run }) => {
      await run.rm("./dist");
    },
  });

  async viteConfigPath() {
    try {
      const viteConfigPath = join(process.cwd(), "vite.config.ts");
      await access(viteConfigPath);
      return viteConfigPath;
    } catch {
      const viteConfigPath = join(
        process.cwd(),
        "node_modules",
        ".alepha",
        "vite.config.ts",
      );
      await mkdir(join(process.cwd(), "node_modules", ".alepha"), {
        recursive: true,
      }).catch(() => null);
      await writeFile(
        viteConfigPath,
        `
import { viteAlepha } from "alepha/vite";

export default {
  plugins: [
    viteAlepha(),
  ],
  test: {
    globals: true,
  },
};
        `.trim(),
      );
      return viteConfigPath;
    }
  }
}
