import { $inject, AlephaError } from "alepha";
import { ShellProvider } from "alepha/system";

/**
 * `lore code import`: an existing checkout pushed into a Lore repository
 * (#Q3935, folio #F1527 findings 1 and 2).
 *
 * ## Why slices
 *
 * Artifacts refuses a large push at unpack (`pack offset metadata exceeds
 * memory budget`): this repository's `main`, 199k objects and 78.8 MB,
 * failed in one push and passed in seven of at most 40,000 new objects.
 * Lore's zone also caps a request body at 100 MB. So on Artifacts the
 * default branch goes in by its first-parent history, each push moving it
 * forward by as many commits as fit {@link LoreCodeImportBudget}.
 *
 * - **Counted, not searched**: a candidate range is counted once
 *   (`git rev-list --count --objects`, `--disk-usage`), the next candidate
 *   estimated from the objects per commit the last one carried.
 * - **Halved on refusal**: a slice Artifacts refuses with the memory-budget
 *   error is retried at half the budget.
 * - **A merge over the budget alone** is pushed in two: its second parent's
 *   history first, to a temporary ref (`refs/lore-import/<n>`), sliced the
 *   same way, then the merge itself; the temporary refs are deleted at the
 *   end. The default branch only ever moves forward.
 * - **Resumable**: the remote's refs are read first, and what it holds is
 *   never pushed again.
 * - A file over 32 MiB (Artifacts' per-file cap) stops it, named, before
 *   anything is pushed.
 *
 * Then the other local branches, the same way, and the tags. Every push
 * carries the push option `lore-import`, so no commit of an import is linked
 * to a quest. A local backend (a Docker Lore) has no cap: one push.
 */
export class LoreCodeImport {
  protected readonly shell = $inject(ShellProvider);

  /**
   * Artifacts' unpack budget, measured (folio #F1527): 50,047 objects passed,
   * the documented limit is 50,000, and 40,000 leaves room.
   */
  public static readonly MAX_OBJECTS = 40_000;

  /**
   * Under the zone's 100 MB body cap and Artifacts' documented 64 MiB.
   */
  public static readonly MAX_BYTES = 60 * 1024 * 1024;

  /**
   * Artifacts' per-file cap.
   */
  public static readonly MAX_FILE_BYTES = 32 * 1024 * 1024;

  /**
   * Counts spent refining one slice once something fits, before it is
   * pushed: a push to Artifacts costs seconds and an operation, a count a
   * few milliseconds.
   */
  protected static readonly REFINEMENTS = 6;

  /**
   * What Artifacts answers a push over its unpack budget, and what the zone
   * answers a body over its cap.
   */
  protected static readonly TOO_BIG =
    /memory budget|MEMORY_LIMIT|HTTP 413|Payload Too Large|exceeds memory/i;

  public async run(
    options: LoreCodeImportOptions,
  ): Promise<LoreCodeImportResult> {
    const budget: LoreCodeImportBudget = {
      objects: options.maxObjects ?? LoreCodeImport.MAX_OBJECTS,
      bytes: options.maxBytes ?? LoreCodeImport.MAX_BYTES,
    };
    const state: ImportState = {
      options,
      budget,
      pushes: 0,
      tempRefs: [],
      negatives: new Set(),
    };
    const head = await this.revParse(options.root, options.source);
    const remote = await this.remoteRefs(options);
    for (const sha of remote.values()) {
      if (await this.hasCommit(options.root, sha)) state.negatives.add(sha);
    }
    const target = `refs/heads/${options.branch}`;
    const current = remote.get(target);
    if (current && current !== head) {
      if (!(await this.isAncestor(options.root, current, head))) {
        throw new AlephaError(
          `The Lore repository's ${options.branch} (${current.slice(0, 9)}) is not an ancestor of ${options.source} (${head.slice(0, 9)}): it holds other history, and an import only moves a branch forward.`,
        );
      }
    }
    const branches = await this.localBranches(options.root);
    const tags = (await this.localTags(options.root)).filter(
      (tag) => remote.get(tag.ref) !== tag.sha,
    );
    if (options.sliced) {
      await this.refuseLargeFiles(state, [
        head,
        ...branches.map((it) => it.sha),
        ...tags.map((it) => it.sha),
      ]);
    }

    if (current !== head) {
      if (options.sliced) await this.pushChain(state, target, head);
      else await this.push(state, [`${head}:${target}`]);
    }
    state.negatives.add(head);

    for (const branch of branches) {
      const ref = branch.ref;
      // The default branch went first, and the local branch it came from
      // with it.
      if (ref === target || ref === `refs/heads/${options.source}`) continue;
      const there = remote.get(ref);
      if (there === branch.sha) continue;
      if (there && !(await this.isAncestor(options.root, there, branch.sha))) {
        options.log?.(
          `Skipped ${branch.name}: the Lore repository's copy has diverged.`,
        );
        continue;
      }
      if (options.sliced) await this.pushChain(state, ref, branch.sha);
      else await this.push(state, [`${branch.sha}:${ref}`]);
      state.negatives.add(branch.sha);
    }

    for (let i = 0; i < tags.length; i += 100) {
      const batch = tags.slice(i, i + 100);
      await this.push(
        state,
        batch.map((tag) => `${tag.ref}:${tag.ref}`),
      );
    }

    const leftovers = [
      ...state.tempRefs,
      ...[...remote.keys()].filter((ref) =>
        ref.startsWith("refs/lore-import/"),
      ),
    ];
    if (leftovers.length > 0) {
      await this.push(
        state,
        [...new Set(leftovers)].map((ref) => `:${ref}`),
        { mark: false },
      );
    }
    return { head, pushes: state.pushes, tags: tags.length };
  }

  /**
   * Move `ref` to `tip` along `tip`'s first-parent history, a budget at a
   * time.
   */
  protected async pushChain(state: ImportState, ref: string, tip: string) {
    const { root } = state.options;
    const chain = await this.firstParents(root, tip, state.negatives);
    if (chain.length === 0) return;
    const last = chain.length - 1;
    let done = -1;
    let step = await this.firstStep(state, chain);
    while (done < last) {
      const pick = await this.pick(state, chain, done, step);
      if (pick === undefined) continue; // a merge was split: count again
      const { index, size } = pick;
      const sha = chain[index]!;
      const refused = await this.push(state, [`${sha}:${ref}`], {
        tolerateTooBig: true,
      });
      if (refused) {
        state.budget = {
          objects: Math.max(1, Math.floor(state.budget.objects / 2)),
          bytes: Math.max(1, Math.floor(state.budget.bytes / 2)),
        };
        state.options.log?.(
          `Refused as too big: retrying at ${state.budget.objects} objects per push.`,
        );
        step = Math.max(1, Math.floor((index - done) / 2));
        continue;
      }
      state.options.log?.(
        `Pushed ${ref} to ${sha.slice(0, 9)}: ${size.objects} objects, ${(size.bytes / 1024 / 1024).toFixed(1)} MiB (${index + 1}/${chain.length})`,
      );
      state.negatives.add(sha);
      const perCommit = size.objects / Math.max(1, index - done);
      step = Math.max(
        1,
        Math.floor((state.budget.objects * 0.9) / Math.max(1, perCommit)),
      );
      done = index;
    }
  }

  /**
   * The furthest first-parent commit after `done` whose range fits the
   * budget, found with a few counts and no push: a guess from the last
   * slice's objects per commit, then at most
   * {@link LoreCodeImport.REFINEMENTS} more counts, halving the gap between
   * what fits and what does not (history is lumpy: a merge can carry more
   * than a thousand commits before it). Undefined when the next commit was
   * over the budget alone and has been split.
   */
  protected async pick(
    state: ImportState,
    chain: string[],
    done: number,
    step: number,
  ): Promise<
    { index: number; size: { objects: number; bytes: number } } | undefined
  > {
    const { root } = state.options;
    const last = chain.length - 1;
    let fit:
      | { index: number; size: { objects: number; bytes: number } }
      | undefined;
    let over: number | undefined;
    let candidate = Math.min(last, done + Math.max(1, step));
    let tries = 0;
    for (;;) {
      if (fit) tries++;
      const size = await this.sizeOf(root, chain[candidate]!, state.negatives);
      const fill = Math.max(
        size.objects / state.budget.objects,
        size.bytes / state.budget.bytes,
      );
      if (fill <= 1) {
        fit = { index: candidate, size };
        if (
          candidate === last ||
          fill >= 0.9 ||
          tries >= LoreCodeImport.REFINEMENTS ||
          (over !== undefined && over - candidate <= 1)
        ) {
          return fit;
        }
        candidate =
          over === undefined
            ? Math.min(last, candidate + (candidate - done))
            : Math.floor((candidate + over) / 2);
        continue;
      }
      over = candidate;
      if (!fit) {
        if (candidate === done + 1) {
          await this.descend(state, chain[candidate]!, size);
          return undefined;
        }
        candidate =
          done + Math.max(1, Math.floor(((candidate - done) * 0.9) / fill));
        continue;
      }
      if (over - fit.index <= 1 || tries >= LoreCodeImport.REFINEMENTS) {
        return fit;
      }
      candidate = Math.floor((fit.index + over) / 2);
    }
  }

  /**
   * One first-parent commit over the budget alone: its second parent's
   * history goes first, to a temporary ref.
   */
  protected async descend(
    state: ImportState,
    sha: string,
    size: { objects: number; bytes: number },
  ) {
    const { root } = state.options;
    const parents = (
      await this.git(root, ["rev-list", "--parents", "-n", "1", sha])
    ).split(" ");
    const second = parents[2];
    if (!second || state.negatives.has(second)) {
      throw new AlephaError(
        `Commit ${sha.slice(0, 9)} alone carries ${size.objects} new objects (${(size.bytes / 1024 / 1024).toFixed(1)} MiB), over what one push may hold (${state.budget.objects} objects, ${(state.budget.bytes / 1024 / 1024).toFixed(1)} MiB), and is no merge to split.`,
      );
    }
    const temp = `refs/lore-import/${state.tempRefs.length + 1}`;
    state.tempRefs.push(temp);
    state.options.log?.(
      `Merge ${sha.slice(0, 9)} is over the budget alone: its second parent first, through ${temp}.`,
    );
    await this.pushChain(state, temp, second);
    state.negatives.add(second);
  }

  protected async firstStep(state: ImportState, chain: string[]) {
    const total = await this.sizeOf(
      state.options.root,
      chain[chain.length - 1]!,
      state.negatives,
    );
    const ratio = Math.min(
      state.budget.objects / Math.max(1, total.objects),
      state.budget.bytes / Math.max(1, total.bytes),
    );
    return Math.max(1, Math.floor(chain.length * Math.min(1, ratio * 0.9)));
  }

  /**
   * New objects and their packed bytes between `sha` and what the remote
   * holds: two counts, one range.
   */
  protected async sizeOf(root: string, sha: string, negatives: Set<string>) {
    const range = [sha, ...[...negatives].map((it) => `^${it}`)];
    const objects = Number(
      await this.git(root, ["rev-list", "--count", "--objects", ...range]),
    );
    const bytes = Number(
      await this.git(root, ["rev-list", "--disk-usage", "--objects", ...range]),
    );
    return { objects, bytes };
  }

  protected async refuseLargeFiles(state: ImportState, tips: string[]) {
    const { root } = state.options;
    const listed = await this.git(root, [
      "rev-list",
      "--objects",
      ...new Set(tips),
      ...[...state.negatives].map((it) => `^${it}`),
    ]);
    if (!listed) return;
    const checked = await this.shell.capture(
      [
        "git",
        "cat-file",
        "--batch-check=%(objecttype) %(objectsize) %(objectname) %(rest)",
      ],
      {
        root,
        stdin: `${listed
          .split("\n")
          .map((line) => line.split(" ")[0])
          .join("\n")}\n`,
      },
    );
    const names = new Map(
      listed.split("\n").map((line) => {
        const at = line.indexOf(" ");
        return at === -1 ? [line, ""] : [line.slice(0, at), line.slice(at + 1)];
      }),
    );
    const max = state.options.maxFileBytes ?? LoreCodeImport.MAX_FILE_BYTES;
    const large = checked.stdout
      .split("\n")
      .map((line) => line.split(" "))
      .filter(([type, size]) => type === "blob" && Number(size) > max)
      .map(
        ([, size, id]) =>
          `${names.get(id ?? "") || id} (${(Number(size) / 1024 / 1024).toFixed(1)} MiB)`,
      );
    if (large.length > 0) {
      throw new AlephaError(
        `Artifacts holds no file over ${max / 1024 / 1024} MiB, and this history has ${large.length}: ${large.slice(0, 10).join(", ")}${large.length > 10 ? ", ..." : ""}. Nothing was pushed.`,
      );
    }
  }

  /**
   * One `git push`, marked as an import. Answers true when it was refused as
   * too big and `tolerateTooBig` asked to be told rather than thrown at.
   */
  protected async push(
    state: ImportState,
    refspecs: string[],
    options: { tolerateTooBig?: boolean; mark?: boolean } = {},
  ): Promise<boolean> {
    const args = [
      "push",
      "--porcelain",
      ...(options.mark === false ? [] : ["--push-option=lore-import"]),
      state.options.url,
      ...refspecs,
    ];
    const result = await this.shell.capture(["git", ...args], {
      root: state.options.root,
    });
    state.pushes += 1;
    if (result.exitCode === 0) return false;
    const output = `${result.stderr}\n${result.stdout}`;
    if (options.tolerateTooBig && LoreCodeImport.TOO_BIG.test(output)) {
      return true;
    }
    throw new AlephaError(`git push failed: ${output.trim().slice(-2000)}`);
  }

  protected async remoteRefs(options: LoreCodeImportOptions) {
    const listed = await this.git(options.root, ["ls-remote", options.url]);
    const refs = new Map<string, string>();
    for (const line of listed.split("\n")) {
      const [sha, ref] = line.split("\t");
      if (sha && ref && !ref.endsWith("^{}")) refs.set(ref, sha);
    }
    return refs;
  }

  protected async firstParents(
    root: string,
    tip: string,
    negatives: Set<string>,
  ) {
    const listed = await this.git(root, [
      "rev-list",
      "--first-parent",
      "--reverse",
      tip,
      ...[...negatives].map((it) => `^${it}`),
    ]);
    return listed ? listed.split("\n") : [];
  }

  protected async localBranches(root: string) {
    const listed = await this.git(root, [
      "for-each-ref",
      "--format=%(refname:short) %(objectname) %(refname)",
      "refs/heads",
    ]);
    return listed
      ? listed.split("\n").map((line) => {
          const [name, sha, ref] = line.split(" ");
          return { name: name!, sha: sha!, ref: ref! };
        })
      : [];
  }

  protected async localTags(root: string) {
    const listed = await this.git(root, [
      "for-each-ref",
      "--format=%(refname) %(objectname)",
      "refs/tags",
    ]);
    return listed
      ? listed.split("\n").map((line) => {
          const [ref, sha] = line.split(" ");
          return { ref: ref!, sha: sha! };
        })
      : [];
  }

  protected async revParse(root: string, rev: string) {
    return this.git(root, ["rev-parse", "--verify", `${rev}^{commit}`]);
  }

  protected async hasCommit(root: string, sha: string) {
    const result = await this.shell.capture(
      ["git", "cat-file", "-e", `${sha}^{commit}`],
      { root },
    );
    return result.exitCode === 0;
  }

  protected async isAncestor(root: string, ancestor: string, of: string) {
    const result = await this.shell.capture(
      ["git", "merge-base", "--is-ancestor", ancestor, of],
      { root },
    );
    return result.exitCode === 0;
  }

  protected async git(root: string, args: string[]): Promise<string> {
    const result = await this.shell.capture(["git", ...args], { root });
    if (result.exitCode !== 0) {
      throw new AlephaError(
        `git ${args[0]} failed: ${result.stderr.trim().slice(-1000)}`,
      );
    }
    return result.stdout.trim();
  }
}

export interface LoreCodeImportOptions {
  /**
   * The checkout.
   */
  root: string;
  /**
   * The Lore clone URL.
   */
  url: string;
  /**
   * The local branch (or any rev) that becomes the default branch.
   */
  source: string;
  /**
   * The repository's default branch.
   */
  branch: string;
  /**
   * Slice the pushes: true on Artifacts, false on a local backend.
   */
  sliced: boolean;
  maxObjects?: number;
  maxBytes?: number;
  maxFileBytes?: number;
  log?: (line: string) => void;
}

export interface LoreCodeImportBudget {
  objects: number;
  bytes: number;
}

export interface LoreCodeImportResult {
  head: string;
  pushes: number;
  tags: number;
}

interface ImportState {
  options: LoreCodeImportOptions;
  budget: LoreCodeImportBudget;
  pushes: number;
  tempRefs: string[];
  negatives: Set<string>;
}
