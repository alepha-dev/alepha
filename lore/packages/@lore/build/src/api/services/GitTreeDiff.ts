import { $inject } from "alepha";

import { GitBackend, type GitTreeEntry } from "../backends/GitBackend.ts";

/**
 * The paths that differ between two trees (#Q4132), shared by the commit
 * index and the diff (#Q4135): the same walk on both backends, which read
 * one tree level at a time.
 *
 * - Only subtrees whose sha differs are read: an unchanged directory costs
 *   nothing however deep it is.
 * - A deleted and an added blob with the same sha are a rename, paired in
 *   path order so the answer is the same on every run. An empty file is
 *   never paired, as in git: every empty file shares one sha.
 * - Bounded: past `maxChanges` changed paths or `maxTreeReads` tree reads
 *   the answer stops and says `partial`.
 */
export class GitTreeDiff {
  /**
   * The blob of an empty file, which git never treats as a rename.
   */
  public static readonly EMPTY_BLOB =
    "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

  public static readonly MAX_CHANGES = 10_000;
  public static readonly MAX_TREE_READS = 2_000;

  protected readonly backend = $inject(GitBackend);

  /**
   * The changes from `from` to `to`, two tree shas (`undefined` is the
   * empty tree: a root commit's parent), sorted by path.
   */
  public async diff(
    ref: string,
    from: string | undefined,
    to: string | undefined,
    options: GitTreeDiffOptions = {},
  ): Promise<GitTreeDiffResult> {
    const state: WalkState = {
      ref,
      changes: [],
      reads: 0,
      partial: false,
      maxChanges: options.maxChanges ?? GitTreeDiff.MAX_CHANGES,
      maxReads: options.maxTreeReads ?? GitTreeDiff.MAX_TREE_READS,
      cache: options.cache ?? new Map(),
    };
    if (from !== to) await this.walk(state, from, to, "");
    const changes = GitTreeDiff.pairRenames(state.changes);
    return { changes, partial: state.partial };
  }

  protected async read(
    state: WalkState,
    sha: string | undefined,
  ): Promise<GitTreeEntry[]> {
    if (!sha) return [];
    const cached = state.cache.get(sha);
    if (cached) return cached;
    if (state.reads >= state.maxReads) {
      state.partial = true;
      return [];
    }
    state.reads += 1;
    const entries = (await this.backend.readTree(state.ref, sha)) ?? [];
    if (state.cache.size > 5_000) state.cache.clear();
    state.cache.set(sha, entries);
    return entries;
  }

  protected async walk(
    state: WalkState,
    from: string | undefined,
    to: string | undefined,
    prefix: string,
  ): Promise<void> {
    const [before, after] = await Promise.all([
      this.read(state, from),
      this.read(state, to),
    ]);
    // A tree the cap left unread is not an empty one.
    if (state.partial) return;
    const old = new Map(before.map((entry) => [entry.name, entry]));
    const now = new Map(after.map((entry) => [entry.name, entry]));
    const names = [...new Set([...old.keys(), ...now.keys()])].sort();
    for (const name of names) {
      if (state.partial) return;
      const o = old.get(name);
      const n = now.get(name);
      const path = `${prefix}${name}`;
      if (o && n && o.sha === n.sha && o.mode === n.mode) continue;
      const oTree = o?.type === "tree";
      const nTree = n?.type === "tree";
      if (oTree || nTree) {
        await this.walk(
          state,
          oTree ? o.sha : undefined,
          nTree ? n.sha : undefined,
          `${path}/`,
        );
      }
      if (o && !oTree && n && !nTree) {
        this.add(state, {
          path,
          kind: "modified",
          oldBlobSha: o.sha,
          newBlobSha: n.sha,
          oldMode: o.mode,
          newMode: n.mode,
          submodule: o.type === "commit" || n.type === "commit",
        });
        continue;
      }
      if (o && !oTree) {
        this.add(state, {
          path,
          kind: "deleted",
          oldBlobSha: o.sha,
          oldMode: o.mode,
          submodule: o.type === "commit",
        });
      }
      if (n && !nTree) {
        this.add(state, {
          path,
          kind: "added",
          newBlobSha: n.sha,
          newMode: n.mode,
          submodule: n.type === "commit",
        });
      }
    }
  }

  protected add(state: WalkState, change: GitTreeChange) {
    if (state.changes.length >= state.maxChanges) {
      state.partial = true;
      return;
    }
    state.changes.push(change);
  }

  /**
   * Pair each deleted blob with the first added one of the same sha, both
   * in path order, into a `renamed` change at the new path.
   */
  public static pairRenames(changes: GitTreeChange[]): GitTreeChange[] {
    const added = new Map<string, GitTreeChange[]>();
    for (const change of changes) {
      if (
        change.kind === "added" &&
        !change.submodule &&
        change.newBlobSha !== GitTreeDiff.EMPTY_BLOB
      ) {
        const list = added.get(change.newBlobSha!) ?? [];
        list.push(change);
        added.set(change.newBlobSha!, list);
      }
    }
    const paired = new Set<GitTreeChange>();
    const out: GitTreeChange[] = [];
    for (const change of changes) {
      if (change.kind !== "deleted" || change.submodule) continue;
      const target = added
        .get(change.oldBlobSha!)
        ?.find((it) => !paired.has(it));
      if (!target) continue;
      paired.add(target);
      paired.add(change);
      out.push({
        ...target,
        kind: "renamed",
        oldPath: change.path,
        oldBlobSha: change.oldBlobSha,
        oldMode: change.oldMode,
      });
    }
    for (const change of changes) {
      if (!paired.has(change)) out.push(change);
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}

export interface GitTreeChange {
  path: string;
  /**
   * Where a `renamed` blob came from.
   */
  oldPath?: string;
  kind: "added" | "modified" | "deleted" | "renamed";
  oldBlobSha?: string;
  newBlobSha?: string;
  oldMode?: string;
  newMode?: string;
  /**
   * A submodule's gitlink, whose "blob" is a commit of another repository.
   */
  submodule?: boolean;
}

export interface GitTreeDiffOptions {
  maxChanges?: number;
  maxTreeReads?: number;
  /**
   * Trees already read, by sha: a walk over many commits passes one, and
   * a tree two neighbours share is read once.
   */
  cache?: Map<string, GitTreeEntry[]>;
}

export interface GitTreeDiffResult {
  changes: GitTreeChange[];
  /**
   * The walk stopped at a cap: `changes` is a prefix.
   */
  partial: boolean;
}

interface WalkState {
  ref: string;
  changes: GitTreeChange[];
  reads: number;
  partial: boolean;
  maxChanges: number;
  maxReads: number;
  cache: Map<string, GitTreeEntry[]>;
}
