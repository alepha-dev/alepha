import { $inject, $use, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { appEntryOptions } from "../atoms/appEntryOptions.ts";

/**
 * Service for locating entry files in Alepha projects.
 *
 * Originally in alepha/vite, moved to CLI to avoid cli -> vite dependency.
 */
export class AppEntryProvider {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly options = $use(appEntryOptions);

  protected readonly serverEntries = [
    "main.server.ts",
    "main.server.tsx",
    "main.ts",
    "main.tsx",
  ] as const;

  protected readonly browserEntries = [
    "main.browser.ts",
    "main.browser.tsx",
    "main.ts",
    "main.tsx",
  ] as const;

  protected readonly styleEntries = [
    "main.css",
    "styles.css",
    "style.css",
  ] as const;

  /**
   * Get application entry points.
   *
   * Server entry is required, an error is thrown if not found.
   * Browser entry is optional.
   *
   * It will first check for custom entries in options, see appEntryOptions.
   */
  public async getAppEntry(root: string): Promise<AppEntry> {
    const appEntry: AppEntry = {
      root,
      server: "",
    };

    if (this.options.server) {
      const serverExists = await this.fs.exists(
        this.fs.join(root, this.options.server),
      );
      if (!serverExists) {
        throw new AlephaError(
          `Custom server entry "${this.options.server}" not found.`,
        );
      }
      appEntry.server = this.options.server;
    }

    if (this.options.browser) {
      const browserExists = await this.fs.exists(
        this.fs.join(root, this.options.browser),
      );
      if (!browserExists) {
        throw new AlephaError(
          `Custom browser entry "${this.options.browser}" not found.`,
        );
      }
      appEntry.browser = this.options.browser;
    }

    if (this.options.style) {
      const styleExists = await this.fs.exists(
        this.fs.join(root, this.options.style),
      );
      if (!styleExists) {
        throw new AlephaError(
          `Custom style entry "${this.options.style}" not found.`,
        );
      }
      appEntry.style = this.options.style;
    }

    const srcFiles = await this.fs.ls(this.fs.join(root, "src"));

    if (!appEntry.server) {
      // find in conventional locations
      for (const entry of this.serverEntries) {
        if (srcFiles.includes(entry)) {
          appEntry.server = this.fs.join("src", entry);
          break;
        }
      }
    }

    if (!appEntry.server) {
      throw new AlephaError(
        "No server entry found. Please, add a main.server.ts file in the src/ directory or configure a custom entry in alepha.config.ts.",
      );
    }

    if (!appEntry.browser) {
      // find in conventional locations
      for (const entry of this.browserEntries) {
        if (srcFiles.includes(entry)) {
          appEntry.browser = this.fs.join("src", entry);
          break;
        }
      }
    }

    if (!appEntry.style) {
      // find in conventional locations
      for (const entry of this.styleEntries) {
        if (srcFiles.includes(entry)) {
          appEntry.style = this.fs.join("src", entry);
          break;
        }
      }
    }

    return appEntry;
  }
}

export interface AppEntry {
  root: string;
  server: string;
  browser?: string;
  style?: string;
}
