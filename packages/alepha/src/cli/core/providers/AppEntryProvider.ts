import { $inject, $store, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { appEntryOptions } from "../atoms/appEntryOptions.ts";

/**
 * Service for locating entry files in Alepha projects.
 *
 * Resolves application entry points for the CLI build pipeline.
 */
export class AppEntryProvider {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly options = $store(appEntryOptions);

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
      const serverPath = this.fs.join(root, this.options.server);
      const serverExists = await this.fs.exists(serverPath);
      if (!serverExists) {
        throw new AlephaError(`Custom server entry not found: ${serverPath}`);
      }
      appEntry.server = this.options.server;
    }

    if (this.options.browser) {
      const browserPath = this.fs.join(root, this.options.browser);
      const browserExists = await this.fs.exists(browserPath);
      if (!browserExists) {
        throw new AlephaError(`Custom browser entry not found: ${browserPath}`);
      }
      appEntry.browser = this.options.browser;
    }

    if (this.options.style) {
      const stylePath = this.fs.join(root, this.options.style);
      const styleExists = await this.fs.exists(stylePath);
      if (!styleExists) {
        throw new AlephaError(`Custom style entry not found: ${stylePath}`);
      }
      appEntry.style = this.options.style;
    }

    // `ls` is a raw readdir and throws ENOENT for a missing directory. A
    // project that configures its entries explicitly has no reason to own a
    // `src/`, and the raw errno says nothing about what the CLI wanted.
    const srcFiles = await this.fs
      .ls(this.fs.join(root, "src"))
      .catch(() => [] as string[]);

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
      const srcDir = this.fs.join(root, "src");
      const tried = this.serverEntries
        .map((e) => this.fs.join(srcDir, e))
        .join(", ");
      throw new AlephaError(
        `No server entry found. Tried: ${tried}. Add a main.server.ts file or configure a custom entry in alepha.config.ts.`,
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
