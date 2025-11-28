import { cp, writeFile } from "node:fs/promises";
import { fileExists } from "../helpers/fileExists.ts";

export interface GenerateDockerOptions {
  /**
   * The directory where the build output is placed.
   *
   * @default "dist"
   */
  distDir?: string;

  /**
   * Docker image name to use in the Dockerfile.
   *
   * @default "node:24-alpine"
   */
  image?: string;

  /**
   * Command to run in the Docker container.
   *
   * @default "node"
   */
  command?: string;
}

/**
 * Generate Docker deployment configuration.
 *
 * This task creates:
 * - Dockerfile with configurable Node image
 * - Copies drizzle migrations if they exist
 */
export async function generateDocker(
  opts: GenerateDockerOptions = {},
): Promise<void> {
  const distDir = opts.distDir ?? "dist";
  const image = opts.image ?? "node:24-alpine";
  const command = opts.command ?? "node";

  // Copy drizzle migrations if they exist
  const hasMigrations = await fileExists("drizzle");
  if (hasMigrations) {
    await cp("drizzle", `${distDir}/drizzle`, {
      recursive: true,
    });
  }

  const dockerfile = `# This file was automatically generated. DO NOT MODIFY.
# Changes to this file will be lost when the code is regenerated.
FROM ${image}
WORKDIR /app

COPY . .

CMD ["${command}", "index.js"]
`;

  await writeFile(`${distDir}/Dockerfile`, dockerfile);
}
