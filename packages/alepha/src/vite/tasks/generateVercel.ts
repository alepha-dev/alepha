import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { importVite } from "../helpers/importVite.ts";

export interface GenerateVercelOptions {
  /**
   * The directory where the build output is placed.
   *
   * @default "dist"
   */
  distDir?: string;

  /**
   * The name of the client directory.
   *
   * @default "public"
   */
  clientDir?: string;

  /**
   * Vercel configuration options.
   */
  config?: VercelConfig;
}

export interface VercelConfig {
  projectName?: string;
  orgId?: string;
  projectId?: string;
  config?: Record<string, any> & {
    crons?: Array<{
      path: string;
      schedule: string;
    }>;
  };
}

const WARNING_COMMENT =
  "// This file was automatically generated. DO NOT MODIFY.\n" +
  "// Changes to this file will be lost when the code is regenerated.\n";

/**
 * Generate Vercel deployment configuration.
 *
 * This task creates:
 * - vercel.json with route rewrites
 * - api/index.js entry point for Vercel serverless function
 * - .vercel/project.json if VERCEL_PROJECT_ID and VERCEL_ORG_ID are set
 */
export async function generateVercel(
  opts: GenerateVercelOptions = {},
): Promise<void> {
  const distDir = opts.distDir ?? "dist";
  const clientDir = opts.clientDir ?? "public";
  const { loadEnv } = await importVite();

  const env = loadEnv("production", process.cwd(), "");

  // Ensure the api directory exists
  if (!existsSync(`${distDir}/api`)) {
    mkdirSync(`${distDir}/api`);
  }

  // Add the only one entry point for Vercel
  writeFileSync(
    `${distDir}/api/index.js`,
    `${WARNING_COMMENT}
import "../index.js";

export default async function (req, res) {
\tawait __alepha.start();
\t__alepha.events.emit("node:request", { req, res });
}
`,
  );

  // Always generate a vercel.json file
  writeFileSync(
    `${distDir}/vercel.json`,
    JSON.stringify(
      {
        ...opts?.config?.config,
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

  // Generate .vercel/project.json if VERCEL_PROJECT_ID and VERCEL_ORG_ID are set
  const projectId = env.VERCEL_PROJECT_ID ?? opts.config?.projectId;
  const projectName = env.VERCEL_PROJECT_NAME ?? opts.config?.projectName;
  const orgId = env.VERCEL_ORG_ID ?? opts.config?.orgId;

  if (projectId && orgId) {
    try {
      mkdirSync(`${distDir}/.vercel`, { recursive: true });
    } catch (_e) {
      // Ignore error if directory already exists
    }

    writeFileSync(
      `${distDir}/.vercel/project.json`,
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

  // If /public does not exist, create an empty one to avoid Vercel errors
  if (!existsSync(`${distDir}/${clientDir}`)) {
    mkdirSync(`${distDir}/${clientDir}`, { recursive: true });
    writeFileSync(`${distDir}/${clientDir}/.keep`, "");
  }
}
