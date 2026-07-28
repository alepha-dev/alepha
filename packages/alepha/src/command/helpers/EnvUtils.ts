import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

export class EnvUtils {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Load environment variables from .env files into process.env.
   *
   * Variables that already exist in process.env are NOT overwritten,
   * matching the standard dotenv convention where the shell environment
   * takes precedence over .env file values.
   *
   * For EVERY file given, the `.local` sibling is also loaded and takes
   * precedence — so the default `[".env"]` reads `.env` then `.env.local`,
   * and `[".env", ".env.production"]` reads four files in that order. This
   * was always the behaviour; the doc used to describe only the default
   * case, which made the multi-file form surprising.
   */
  public async loadEnv(
    root: string,
    files: string[] = [".env"],
  ): Promise<void> {
    const vars = await this.parseEnv(root, files);
    for (const [key, value] of Object.entries(vars)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
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
                let value = rest.join("=").trim();
                const last = value.length - 1;
                if (
                  value.length >= 2 &&
                  value[0] === '"' &&
                  value[last] === '"'
                ) {
                  // Double-quoted: JSON-decode so escapes round-trip with a
                  // `JSON.stringify`-based writer (e.g. Rocket's
                  // `.env.<env>.local` overrides, which write JSON values like
                  // CLUB_CONFIG_JSON). Falls back to a naive strip when the
                  // body isn't valid JSON (e.g. a Windows path with `\`), so
                  // simple `KEY="value"` still behaves as before.
                  try {
                    value = JSON.parse(value);
                  } catch {
                    value = value.slice(1, -1);
                  }
                } else if (
                  value.length >= 2 &&
                  value[0] === "'" &&
                  value[last] === "'"
                ) {
                  value = value.slice(1, -1);
                }
                result[trimmedKey] = value;
              }
            }
          }
          this.log.debug(`Parsed environment variables from ${envPath}`);
        } catch (error) {
          // Only "not there" is routine. Swallowing everything hid a real
          // EACCES / EISDIR behind a debug line, so a .env the process could
          // not read looked identical to one that did not exist.
          const code = (error as { code?: string })?.code;
          if (code && code !== "ENOENT") {
            this.log.warn(`Could not read ${envPath}: ${code}`, error);
            continue;
          }
          this.log.debug(`No ${file} file found at ${envPath}, skipping.`);
        }
      }
    }

    return result;
  }
}
