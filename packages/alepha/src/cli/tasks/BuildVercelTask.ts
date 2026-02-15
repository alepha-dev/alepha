import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Generate Vercel deployment configuration.
 *
 * Creates:
 * - vercel.json with route rewrites
 * - api/index.js entry point for Vercel serverless function
 * - .vercel/project.json if VERCEL_PROJECT_ID and VERCEL_ORG_ID are set
 */
export class BuildVercelTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);

  protected readonly warningComment =
    "// This file was automatically generated. DO NOT MODIFY.\n" +
    "// Changes to this file will be lost when the code is regenerated.\n";

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.options.target !== "vercel") {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const clientDir = ctx.options.output?.public ?? "public";
    const root = ctx.root;

    await ctx.run({
      name: "add Vercel config",
      handler: async () => {
        await this.writeApiEntryPoint(root, distDir);
        await this.writeVercelConfig(
          root,
          distDir,
          clientDir,
          ctx.options.vercel?.config,
        );

        const projectId =
          process.env.VERCEL_PROJECT_ID ?? ctx.options.vercel?.projectId;
        const projectName =
          process.env.VERCEL_PROJECT_NAME ?? ctx.options.vercel?.projectName;
        const orgId = process.env.VERCEL_ORG_ID ?? ctx.options.vercel?.orgId;

        if (projectId && orgId) {
          await this.writeProjectConfig(
            root,
            distDir,
            projectId,
            projectName,
            orgId,
          );
        }

        await this.ensureClientDir(root, distDir, clientDir);
      },
    });
  }

  protected async writeApiEntryPoint(
    root: string,
    distDir: string,
  ): Promise<void> {
    const apiDir = this.fs.join(root, distDir, "api");
    await this.fs.mkdir(apiDir);
    await this.fs.writeFile(
      this.fs.join(apiDir, "index.js"),
      `${this.warningComment}
import "../index.js";

export default async (req, res) => {
\tawait __alepha.start();
\tawait __alepha.events.emit("node:request", { req, res });
}
`,
    );
  }

  protected async writeVercelConfig(
    root: string,
    distDir: string,
    clientDir: string,
    config?: Record<string, any>,
  ): Promise<void> {
    await this.fs.writeFile(
      this.fs.join(root, distDir, "vercel.json"),
      JSON.stringify(
        {
          ...config,
          rewrites: [
            {
              source: "/(.*)",
              destination: "/api/index.js",
            },
          ],
          buildCommand: "",
          installCommand: "",
          outputDirectory: clientDir,
        },
        null,
        "  ",
      ),
    );
  }

  protected async writeProjectConfig(
    root: string,
    distDir: string,
    projectId: string,
    projectName: string | undefined,
    orgId: string,
  ): Promise<void> {
    const vercelDir = this.fs.join(root, distDir, ".vercel");
    await this.fs.mkdir(vercelDir);
    await this.fs.writeFile(
      this.fs.join(vercelDir, "project.json"),
      JSON.stringify(
        {
          projectId,
          projectName,
          orgId,
        },
        null,
        "  ",
      ),
    );
  }

  protected async ensureClientDir(
    root: string,
    distDir: string,
    clientDir: string,
  ): Promise<void> {
    const path = this.fs.join(root, distDir, clientDir);
    if (!(await this.fs.exists(path))) {
      await this.fs.mkdir(path);
      await this.fs.writeFile(this.fs.join(path, ".keep"), "");
    }
  }
}
