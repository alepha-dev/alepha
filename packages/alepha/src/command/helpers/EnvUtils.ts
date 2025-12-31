import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $logger } from "alepha/logger";

export class EnvUtils {
  protected readonly log = $logger();

  /**
   * Load environment variables from .env files into process.env.
   * By default, it loads from ".env" and ".env.local".
   * You can specify additional files to load, e.g. [".env", ".env.production"].
   */
  public async loadEnv(
    root: string,
    files: string[] = [".env"],
  ): Promise<void> {
    for (const it of files) {
      for (const file of [it, `${it}.local`]) {
        const envPath = join(root, file);
        try {
          const envContent = await readFile(envPath, "utf8");
          const lines = envContent.split("\n");
          for (const line of lines) {
            const [key, ...rest] = line.split("=");
            if (key) {
              const value = rest.join("=");
              process.env[key.trim()] = value.trim();
            }
          }
          this.log.debug(`Loaded environment variables from ${envPath}`);
        } catch {
          this.log.debug(`No ${file} file found at ${envPath}, skipping load.`);
        }
      }
    }
  }
}
