import { AlephaError } from "alepha";

/**
 * Who may read a file in a bucket a feature module owns (#E75, #Q2623):
 * quest and feedback attachments (Work), folio attachments (Knowledge).
 *
 * `LoreFileAccessProvider` is core and reads no module's table. For a bucket
 * a module registered, it asks the module which project the file belongs to
 * and which permission reads it, then asserts that permission there. A bucket
 * nobody registered stays creator-only, the framework's default.
 */
export class FileAccessRegistry {
  protected readonly rules = new Map<string, FileAccessRule>();

  public register(bucket: string, rule: FileAccessRule): void {
    if (this.rules.has(bucket)) {
      throw new AlephaError(
        `File access for bucket '${bucket}' is registered twice`,
      );
    }
    this.rules.set(bucket, rule);
  }

  public rule(bucket: string): FileAccessRule | undefined {
    return this.rules.get(bucket);
  }
}

/**
 * The project a file belongs to and the permission that reads it there, or
 * `undefined` for a file no row of the module references, or that this
 * reader may not see whatever their rank.
 *
 * `reader` is who asks (#Q3939): a rank says what a member may read in a
 * project, not which private chat room they are in, so a rule that guards
 * something narrower than a project checks the reader itself. Rules that
 * need no more than the project ignore it.
 */
export type FileAccessRule = (
  fileId: string,
  reader: FileAccessReader,
) => Promise<{ projectId: number; permission: string } | undefined>;

/**
 * Who reads a file, as a {@link FileAccessRule} sees them.
 */
export interface FileAccessReader {
  id: string;
}
