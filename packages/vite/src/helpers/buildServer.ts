import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AlephaError } from "@alepha/core";
import type * as vite from "vite";
import type { UserConfig } from "vite";
import {
  type ViteAlephaBuildDockerOptions,
  viteAlephaBuildDocker,
} from "../viteAlephaBuildDocker.ts";
import {
  type VercelConfig,
  viteAlephaBuildVercel,
} from "../viteAlephaBuildVercel.ts";
import { viteAlephaExternalsVersion } from "../viteAlephaExternalsVersion.ts";
import { importVite } from "./importVite.ts";

export interface BuildServerOptions {
  entry: string;
  distDir: string;
  clientDir?: string;
  vercel?: boolean | VercelConfig;
  docker?: boolean | ViteAlephaBuildDockerOptions;
  config?: UserConfig;
}

export const buildServer = async (opts: BuildServerOptions) => {
  const { build: viteBuild, mergeConfig } = await importVite();
  const plugins: any[] = [
    viteAlephaExternalsVersion({ distDir: opts.distDir }),
  ];

  if (opts.vercel) {
    const config = typeof opts.vercel === "boolean" ? {} : opts.vercel;
    plugins.push(
      viteAlephaBuildVercel({
        clientDir: opts.clientDir,
        distDir: opts.distDir,
        config,
      }),
    );
  }

  if (opts.docker) {
    const docker = typeof opts.docker === "boolean" ? {} : opts.docker;
    plugins.push(
      viteAlephaBuildDocker({
        distDir: opts.distDir,
        ...docker,
      }),
    );
  }

  const viteBuildServerConfig: UserConfig = {
    mode: "production",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    publicDir: false,
    ssr: {
      noExternal: true,
    },
    build: {
      ssr: opts.entry,
      outDir: `${opts.distDir}/server`,
      minify: false, // for now, we don't need to minify the server build
      rollupOptions: {
        output: {
          entryFileNames: "[hash].js",
          chunkFileNames: "[hash].js",
          assetFileNames: "[hash][extname]",
          format: "esm",
        },
      },
    },
    plugins,
  };

  const result = await viteBuild(
    mergeConfig(viteBuildServerConfig, opts.config || {}),
  );

  const indexFileName = extractIndexFromBundle(opts.entry, result);

  let template = "";

  if (opts.clientDir) {
    const index = await readFile(
      `${opts.distDir}/${opts.clientDir}/index.html`,
      "utf-8",
    );

    template = `process.env.REACT_SERVER_TEMPLATE ??= \`${index.replace(/>\s*</g, "><").trim()}\`;\n`;

    await unlink(`${opts.distDir}/${opts.clientDir}/index.html`);
  }

  const warning =
    "// ⚠️ This file was automatically generated. DO NOT MODIFY." +
    "\n" +
    "// Changes to this file will be lost when the code is regenerated.\n";

  const forceProduction = "process.env.NODE_ENV ??= 'production';\n";

  await writeFile(
    `${opts.distDir}/index.js`,
    `${warning}\n${forceProduction}${template}\nawait import('./server/${indexFileName}');`.trim(),
  );
};

function extractIndexFromBundle(
  entry: string,
  result:
    | vite.Rollup.RollupOutput
    | vite.Rollup.RollupOutput[]
    | vite.Rollup.RollupWatcher,
) {
  const entryFilePath = entry.startsWith("/")
    ? entry
    : join(process.cwd(), entry);

  const rollupOutput = (
    Array.isArray(result) ? result[0] : result
  ) as vite.Rollup.RollupOutput;

  const indexFileName = rollupOutput.output.find(
    (it) => "facadeModuleId" in it && it.facadeModuleId === entryFilePath,
  )?.fileName;

  if (!indexFileName) {
    throw new AlephaError(
      `Could not find the entry file "${entryFilePath}" in the build output. Please check your entry file and try again.`,
    );
  }

  return indexFileName;
}
