import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";

import {
  type BuildManifest,
  buildManifestSchema,
} from "../schemas/buildManifest.ts";

/**
 * The shared artifact reader. Missing files may be probed with readOptional;
 * an existing artifact must carry the supported manifest major and schema.
 */
export class BuildManifestReader {
  protected readonly fs = $inject(FileSystemProvider);

  public async read(path: string): Promise<BuildManifest> {
    return BuildManifestReader.read(this.fs, path);
  }

  public async readOptional(path: string): Promise<BuildManifest | null> {
    if (!(await this.fs.exists(path))) return null;
    return this.read(path);
  }

  /**
   * Shared with filesystem-based deployment helpers outside the container.
   */
  public static async read(
    fs: FileSystemProvider,
    path: string,
  ): Promise<BuildManifest> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readTextFile(path));
    } catch (error) {
      throw new AlephaError(
        `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}. Rebuild with alepha build.`,
      );
    }
    const version =
      raw && typeof raw === "object" && "manifestVersion" in raw
        ? raw.manifestVersion
        : undefined;
    if (version !== 2) {
      throw new AlephaError(
        `${path}: manifestVersion ${version === undefined ? "missing" : JSON.stringify(version)} is unsupported; this reader supports manifestVersion 2. Rebuild with alepha build.`,
      );
    }
    const parsed = buildManifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AlephaError(
        `${path} is not a valid build manifest: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}. Rebuild with alepha build.`,
      );
    }
    return parsed.data;
  }
}
