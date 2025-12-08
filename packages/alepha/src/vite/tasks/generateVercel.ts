import { mkdir, stat, writeFile } from "node:fs/promises";
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

  await writeApiEntryPoint(distDir);
  await writeVercelConfig(distDir, clientDir, opts.config?.config);

  const projectId = env.VERCEL_PROJECT_ID ?? opts.config?.projectId;
  const projectName = env.VERCEL_PROJECT_NAME ?? opts.config?.projectName;
  const orgId = env.VERCEL_ORG_ID ?? opts.config?.orgId;

  if (projectId && orgId) {
    await writeProjectConfig(distDir, projectId, projectName, orgId);
  }

  await ensureClientDir(distDir, clientDir);
}

/**
 * Check if a file or directory exists at the given path
 */
async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

/**
 * Create the serverless function entry point that bootstraps Alepha and handles requests
 */
async function writeApiEntryPoint(distDir: string): Promise<void> {
  await mkdir(`${distDir}/api`, { recursive: true });
  await writeFile(
    `${distDir}/api/index.js`,
    `${WARNING_COMMENT}
import "../index.js";

export default async (req, res) => {
\tawait __alepha.start();
\tawait __alepha.events.emit("node:request", { req, res });
}
`,
  );
}

/**
 * Generate vercel.json with route rewrites to direct all traffic to the serverless function
 */
async function writeVercelConfig(
  distDir: string,
  clientDir: string,
  config?: VercelConfig["config"],
): Promise<void> {
  await writeFile(
    `${distDir}/vercel.json`,
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

/**
 * Generate .vercel/project.json to link the deployment to a Vercel project
 */
async function writeProjectConfig(
  distDir: string,
  projectId: string,
  projectName: string | undefined,
  orgId: string,
): Promise<void> {
  await mkdir(`${distDir}/.vercel`, { recursive: true });
  await writeFile(
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

/**
 * Create the client directory with a .keep file if it doesn't exist to avoid Vercel errors
 */
async function ensureClientDir(
  distDir: string,
  clientDir: string,
): Promise<void> {
  const path = `${distDir}/${clientDir}`;
  if (!(await exists(path))) {
    await mkdir(path, { recursive: true });
    await writeFile(`${path}/.keep`, "");
  }
}
