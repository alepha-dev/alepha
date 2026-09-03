import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { userInfo } from "node:os";
import { join } from "node:path";

import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

/**
 * Remembers that a task passed against a particular set of inputs, so an
 * identical run can skip it.
 *
 * The store holds no output, only the fact of a pass. That is a deliberate
 * limit rather than a first cut: restoring a task's artifacts means knowing
 * what they were, and a wrong answer there is a build that looks present and
 * is not. A task whose result is a file on disk is served by
 * `BuildFreshness` and `alepha build --if-stale`, which compares the artifact
 * against its sources rather than trusting a record of the past.
 *
 * ⚠️ Everything a task reads must be in its key. What is in the key is the
 * caller's judgement, and a caller that forgets an input gets a cache that
 * says a task passed when it has never been run against the code in front of
 * it. That is why this is opt-in per task rather than a mode, and why the
 * pipeline that uses it announces every skip.
 */
export class TaskCacheProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * A stable key for a list of parts.
   *
   * Parts are length-prefixed rather than joined by a separator: any separator
   * can also occur inside a part, and then `["a:b", "c"]` and `["a", "b:c"]`
   * hash the same, which is a cache hit between two different things.
   */
  public digest(parts: string[]): string {
    const hash = createHash("sha256");
    for (const part of parts) {
      hash.update(String(part.length));
      hash.update("\0");
      hash.update(part);
    }
    return hash.digest("hex");
  }

  /**
   * Whether a task with this key has already passed.
   *
   * Any failure to read the store answers false. "I cannot tell" has to mean
   * "run it": the alternative is skipping a task on the strength of not having
   * been able to look.
   */
  public async isFresh(key: string): Promise<boolean> {
    try {
      return (await stat(this.entry(key))).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Record that a task with this key passed.
   */
  public async record(key: string): Promise<void> {
    const file = this.entry(key);
    await mkdir(this.baseDir(), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ recordedAt: this.dateTime.nowMillis() }),
      "utf8",
    );
  }

  /**
   * Drop a recorded key, whether or not it was there.
   */
  public async forget(key: string): Promise<void> {
    await rm(this.entry(key), { force: true });
  }

  /**
   * The file backing one key.
   *
   * The key is hashed again on the way to a filename rather than used as one.
   * Callers are expected to pass a digest, but nothing enforces it, and a key
   * shaped like a path would otherwise read and write outside the store.
   */
  protected entry(key: string): string {
    const safe = createHash("sha256").update(key).digest("hex");
    return join(this.baseDir(), `${safe}.json`);
  }

  /**
   * The root of the store.
   *
   * Per user, like the exclusive queue's directory and for the same reason:
   * on Linux the system temp directory is shared and sticky, so entries owned
   * by another user cannot be replaced.
   */
  protected baseDir(): string {
    const configured = this.alepha.env.ALEPHA_CACHE_DIR;
    if (configured) {
      return String(configured);
    }
    return join(tmpdir(), `alepha-cache-${userInfo().uid}`);
  }
}
