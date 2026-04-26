import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Generate Docker deployment configuration and optionally build the image.
 *
 * Creates:
 * - Dockerfile with configurable base image
 * - Copies migrations directory if it exists
 * - Builds Docker image when `--image` flag is provided
 */
export class BuildDockerTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.options.target !== "docker") {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const { runtime } = ctx.options;

    const dockerFrom =
      ctx.options.docker?.from ??
      (runtime === "bun" ? "oven/bun:alpine" : "node:24-alpine");
    const dockerCommand =
      ctx.options.docker?.command ?? (runtime === "bun" ? "bun" : "node");

    await ctx.run({
      name: "generate deploy config (docker)",
      handler: async () => {
        await this.copyMigrations(ctx.root, distDir);
        await this.writeDockerfile(
          ctx.root,
          distDir,
          dockerFrom,
          dockerCommand,
        );
      },
    });

    if (ctx.flags?.image) {
      await this.buildDockerImage(ctx, distDir);
    }
  }

  protected async copyMigrations(
    root: string,
    distDir: string,
  ): Promise<void> {
    const migrationsDir = this.fs.join(root, "migrations");
    if (await this.fs.exists(migrationsDir)) {
      await this.fs.cp(
        migrationsDir,
        this.fs.join(root, distDir, "migrations"),
      );
    }
  }

  protected async writeDockerfile(
    root: string,
    distDir: string,
    image: string,
    command: string,
  ): Promise<void> {
    const dockerfile = `# This file was automatically generated. DO NOT MODIFY.
# Changes to this file will be lost when the code is regenerated.
FROM ${image}
WORKDIR /app

COPY . .

RUN ${command === "bun" ? "bun" : "npm"} install

ENV SERVER_HOST=0.0.0.0

CMD ["${command}", "index.js"]
`;

    await this.fs.writeFile(
      this.fs.join(root, distDir, "Dockerfile"),
      dockerfile,
    );
  }

  protected async buildDockerImage(
    ctx: BuildTaskContext,
    distDir: string,
  ): Promise<void> {
    const imageConfig = ctx.options.docker?.image;
    const flagValue =
      typeof ctx.flags?.image === "string" ? ctx.flags.image : null;

    let imageTag: string;
    let version: string;

    if (!flagValue) {
      if (!imageConfig?.tag) {
        throw new AlephaError(
          "Flag '--image' requires 'build.docker.image.tag' in config",
        );
      }
      version = "latest";
      imageTag = `${imageConfig.tag}:${version}`;
    } else if (flagValue.startsWith(":")) {
      if (!imageConfig?.tag) {
        throw new AlephaError(
          "Flag '--image=:version' requires 'build.docker.image.tag' in config",
        );
      }
      version = flagValue.slice(1);
      imageTag = `${imageConfig.tag}:${version}`;
    } else if (flagValue.includes(":")) {
      imageTag = flagValue;
      version = flagValue.split(":")[1];
    } else {
      imageTag = `${flagValue}:latest`;
      version = "latest";
    }

    const args: string[] = [];

    if (imageConfig?.args) {
      args.push(imageConfig.args);
    }

    if (imageConfig?.oci) {
      const revision = await this.utils.getGitRevision();
      const created = new Date().toISOString();

      args.push(`--label "org.opencontainers.image.revision=${revision}"`);
      args.push(`--label "org.opencontainers.image.created=${created}"`);
      args.push(`--label "org.opencontainers.image.version=${version}"`);
    }

    const argsStr = args.length > 0 ? `${args.join(" ")} ` : "";
    const dockerCmd = `docker build ${argsStr}-t ${imageTag} ${distDir}`;

    await ctx.run(dockerCmd, {
      alias: `docker build ${imageTag}`,
    });
  }
}
