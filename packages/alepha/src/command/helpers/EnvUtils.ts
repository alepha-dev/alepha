import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

export class EnvUtils {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Load environment variables from .env files into process.env.
   * By default, it loads from ".env" and ".env.local".
   * You can specify additional files to load, e.g. [".env", ".env.production"].
   */
  public async loadEnv(
    root: string,
    files: string[] = [".env"],
  ): Promise<void> {
    const vars = await this.parseEnv(root, files);
    for (const [key, value] of Object.entries(vars)) {
      process.env[key] = value;
    }
  }

  /**
   * Parse environment variables from .env files without mutating process.env.
   *
   * Returns a merged record from all files (later files override earlier ones).
   * For each file, also tries the `.local` variant (e.g. `.env.production.local`).
   */
  public async parseEnv(
    root: string,
    files: string[] = [".env"],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const it of files) {
      for (const file of [it, `${it}.local`]) {
        const envPath = this.fs.join(root, file);
        try {
          const buffer = await this.fs.readFile(envPath);
          const envContent = buffer.toString("utf8");
          for (const line of envContent.split("\n")) {
            const [key, ...rest] = line.split("=");
            if (key) {
              const trimmedKey = key.trim();
              if (trimmedKey && !trimmedKey.startsWith("#")) {
                result[trimmedKey] = rest.join("=").trim();
              }
            }
          }
          this.log.debug(`Parsed environment variables from ${envPath}`);
        } catch {
          this.log.debug(`No ${file} file found at ${envPath}, skipping.`);
        }
      }
    }

    return result;
  }
}
