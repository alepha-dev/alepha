/**
 * The reads every `GitBackend` answers the same (#Q4131): one set of
 * assertions, run by Vitest on `LocalGitBackend` and on `ArtifactsGitBackend`
 * over a git-played binding (`test/git-backend-reads.spec.ts`), and by hand
 * on `ArtifactsGitBackend` against a REAL Artifacts namespace
 * (`test/artifacts-contract.ts`): a fake cannot disagree.
 *
 * No Vitest import: `artifacts-contract.ts` runs under plain `node`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AlephaError } from "alepha";

import type { GitBackend } from "../src/api/backends/GitBackend.ts";

/**
 * The shas of the history {@link buildContractFixture} commits.
 */
export interface GitContractFixture {
  /**
   * The working repository, to push from.
   */
  source: string;
  /**
   * The root commit: `README.md` and `src/a.ts`.
   */
  root: string;
  /**
   * The second commit on `main`: `src/deep/b.ts`, `logo.bin` (binary),
   * `big.txt` (4 KiB) and `run.sh` (executable). `v1` (annotated) and
   * `light` (lightweight) tag it.
   */
  second: string;
  /**
   * `main`'s tip, after `second`: `README.md` edited.
   */
  main: string;
  /**
   * The tip of `feat/side`, branched from `second`.
   */
  side: string;
  /**
   * A merge of `feat/side` into a branch `merged` from `main`.
   */
  merge: string;
  /**
   * The annotated tag object `v1`, its own sha.
   */
  tagObject: string;
}

const env = (home: string) => ({
  PATH: process.env.PATH,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Ada Lore",
  GIT_AUTHOR_EMAIL: "ada@example.com",
  GIT_COMMITTER_NAME: "Bob Commit",
  GIT_COMMITTER_EMAIL: "bob@example.com",
});

/**
 * A small history in `<work>/source`, every date fixed so the shas are the
 * same on every run and every machine.
 */
export const buildContractFixture = (work: string): GitContractFixture => {
  const source = join(work, "source");
  let clock = 1_700_000_000;
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: source,
      encoding: "utf8",
      env: {
        ...env(work),
        GIT_AUTHOR_DATE: `${clock} +0000`,
        GIT_COMMITTER_DATE: `${clock + 60} +0000`,
      },
    }).trim();
  const tick = () => {
    clock += 3600;
  };
  mkdirSync(source, { recursive: true });
  git("init", "--quiet", "-b", "main");
  const write = (path: string, content: string | Uint8Array) => {
    mkdirSync(join(source, path, ".."), { recursive: true });
    writeFileSync(join(source, path), content);
  };

  write("README.md", "# Contract\n");
  write("src/a.ts", "export const a = 1;\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "root commit");
  const root = git("rev-parse", "HEAD");

  tick();
  write("src/deep/b.ts", "export const b = 2;\n");
  write("logo.bin", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  write("big.txt", "x".repeat(4096));
  write("run.sh", "#!/bin/sh\necho hi\n");
  git("add", "-A");
  git("update-index", "--chmod=+x", "run.sh");
  git(
    "commit",
    "--quiet",
    "-m",
    "second commit\n\nwith a body\nof two lines\n\nand a paragraph",
  );
  const second = git("rev-parse", "HEAD");
  git("tag", "-a", "v1", "-m", "version one");
  git("tag", "light");
  const tagObject = git("rev-parse", "v1");

  tick();
  git("checkout", "--quiet", "-b", "feat/side");
  write("side.txt", "side\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "side commit");
  const side = git("rev-parse", "HEAD");

  tick();
  git("checkout", "--quiet", "main");
  write("README.md", "# Contract\n\nEdited.\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "edit readme");
  const main = git("rev-parse", "HEAD");

  tick();
  git("checkout", "--quiet", "-b", "merged");
  git("merge", "--quiet", "--no-ff", "-m", "merge side", "feat/side");
  const merge = git("rev-parse", "HEAD");
  git("checkout", "--quiet", "main");

  return { source, root, second, main, side, merge, tagObject };
};

/**
 * Push every branch and tag of the fixture to `remote`.
 */
export const pushContractFixture = (
  work: string,
  fixture: GitContractFixture,
  remote: string,
) => {
  execFileSync("git", ["push", "--quiet", remote, "--all", "--follow-tags"], {
    cwd: fixture.source,
    env: env(work),
  });
  execFileSync("git", ["push", "--quiet", remote, "--tags"], {
    cwd: fixture.source,
    env: env(work),
  });
};

const equal = (actual: unknown, expected: unknown, what: string) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new AlephaError(`${what}: expected ${e}, got ${a}`);
  }
};

/**
 * Every read of #Q4131 against `backend`'s repository `ref`, which holds
 * the pushed fixture. Throws on the first difference.
 */
export const assertGitBackendContract = async (
  backend: GitBackend,
  ref: string,
  f: GitContractFixture,
): Promise<void> => {
  // refs: the annotated tag peeled, the lightweight one not.
  const refs = await backend.refs(ref);
  const v1 = refs.find((tip) => tip.name === "refs/tags/v1");
  equal(
    v1,
    { sha: f.tagObject, name: "refs/tags/v1", targetSha: f.second },
    "refs v1",
  );
  equal(
    refs.find((tip) => tip.name === "refs/tags/light"),
    { sha: f.second, name: "refs/tags/light" },
    "refs light",
  );
  equal(
    refs.find((tip) => tip.name === "refs/heads/feat/side")?.sha,
    f.side,
    "refs feat/side",
  );

  // resolve
  equal(await backend.resolve(ref, "main"), f.main, "resolve main");
  equal(
    await backend.resolve(ref, "refs/heads/main"),
    f.main,
    "resolve refs/heads/main",
  );
  equal(await backend.resolve(ref, "HEAD"), f.main, "resolve HEAD");
  equal(await backend.resolve(ref, "feat/side"), f.side, "resolve feat/side");
  equal(await backend.resolve(ref, "v1"), f.second, "resolve annotated tag");
  equal(
    await backend.resolve(ref, "light"),
    f.second,
    "resolve lightweight tag",
  );
  equal(await backend.resolve(ref, f.root), f.root, "resolve sha");
  equal(
    await backend.resolve(ref, "f".repeat(40)),
    undefined,
    "resolve unknown sha",
  );
  equal(await backend.resolve(ref, "nope"), undefined, "resolve unknown name");
  equal(
    await backend.resolve(ref, "main~1"),
    undefined,
    "resolve refuses an expression",
  );

  // tree: the root, a subdirectory, a nested one, a file path, a missing one.
  const root = await backend.tree(ref, f.second, "");
  equal(
    root?.map((entry) => [entry.name, entry.type, entry.mode]),
    [
      ["README.md", "blob", "100644"],
      ["big.txt", "blob", "100644"],
      ["logo.bin", "blob", "100644"],
      ["run.sh", "blob", "100755"],
      ["src", "tree", "40000"],
    ],
    "tree root",
  );
  equal(
    (await backend.tree(ref, f.root, ""))?.map((entry) => entry.name),
    ["README.md", "src"],
    "tree root of the root commit",
  );
  equal(
    (await backend.tree(ref, f.second, "src"))?.map((entry) => [
      entry.name,
      entry.type,
    ]),
    [
      ["a.ts", "blob"],
      ["deep", "tree"],
    ],
    "tree src",
  );
  equal(
    (await backend.tree(ref, f.second, "src/deep/"))?.map(
      (entry) => entry.name,
    ),
    ["b.ts"],
    "tree src/deep",
  );
  equal(
    await backend.tree(ref, f.second, "README.md"),
    undefined,
    "tree of a file",
  );
  equal(
    await backend.tree(ref, f.second, "missing"),
    undefined,
    "tree missing",
  );
  equal(
    await backend.tree(ref, f.second, "../src"),
    undefined,
    "tree refuses ..",
  );

  // file and blob: text, binary, a size cap checked before the read.
  const readme = await backend.file(ref, f.main, "README.md");
  equal(readme.kind, "ok", "file README kind");
  if (readme.kind === "ok") {
    equal(
      new TextDecoder().decode(readme.bytes),
      "# Contract\n\nEdited.\n",
      "file README bytes",
    );
    equal(readme.binary, false, "file README binary");
    equal(readme.size, 20, "file README size");
  }
  const deep = await backend.file(ref, f.second, "src/deep/b.ts");
  equal(
    deep.kind === "ok" && new TextDecoder().decode(deep.bytes),
    "export const b = 2;\n",
    "file deep",
  );
  const logo = await backend.file(ref, f.second, "logo.bin");
  equal(logo.kind === "ok" && logo.binary, true, "file binary");
  equal(
    await backend.file(ref, f.second, "big.txt", { maxBytes: 1024 }),
    { kind: "too_large", size: 4096 },
    "file too large",
  );
  equal(
    (await backend.file(ref, f.second, "big.txt", { maxBytes: 4096 })).kind,
    "ok",
    "file at the cap",
  );
  equal(
    await backend.file(ref, f.second, "src"),
    { kind: "not_found" },
    "file of a directory",
  );
  equal(
    await backend.file(ref, f.root, "src/deep/b.ts"),
    { kind: "not_found" },
    "file before it existed",
  );
  const blobSha = root?.find((entry) => entry.name === "big.txt")?.sha ?? "";
  equal(
    await backend.blob(ref, blobSha, { maxBytes: 10 }),
    { kind: "too_large", size: 4096 },
    "blob too large",
  );
  equal(
    await backend.blob(ref, "0".repeat(40)),
    { kind: "not_found" },
    "blob missing",
  );

  // commit
  const second = await backend.commit(ref, f.second);
  equal(
    second && {
      parents: second.parents,
      author: second.author,
      committer: second.committer,
      subject: second.subject,
      body: second.body,
    },
    {
      parents: [f.root],
      author: { name: "Ada Lore", email: "ada@example.com", at: 1_700_003_600 },
      committer: {
        name: "Bob Commit",
        email: "bob@example.com",
        at: 1_700_003_660,
      },
      subject: "second commit",
      body: "with a body\nof two lines\n\nand a paragraph",
    },
    "commit second",
  );
  equal(second?.treeSha.length, 40, "commit tree sha");
  equal(
    await backend.readTree(ref, second?.treeSha ?? ""),
    root,
    "readTree of the commit's tree is its root",
  );
  equal(
    (await backend.commit(ref, f.root))?.parents,
    [],
    "commit root has no parent",
  );
  equal(
    (await backend.commit(ref, f.merge))?.parents,
    [f.main, f.side],
    "commit merge parents",
  );
  equal(await backend.commit(ref, "e".repeat(40)), undefined, "commit missing");

  // merge base and ancestry
  equal(
    await backend.mergeBase(ref, f.main, f.side),
    { kind: "ok", sha: f.second },
    "merge base",
  );
  equal(
    await backend.mergeBase(ref, f.side, f.main),
    { kind: "ok", sha: f.second },
    "merge base reversed",
  );
  equal(
    await backend.mergeBase(ref, f.merge, f.side),
    { kind: "ok", sha: f.side },
    "merge base of an ancestor",
  );
  equal(
    await backend.mergeBase(ref, f.main, f.main),
    { kind: "ok", sha: f.main },
    "merge base of itself",
  );
  equal(
    await backend.isAncestor(ref, f.root, f.main),
    { kind: "ok", value: true },
    "ancestor",
  );
  equal(
    await backend.isAncestor(ref, f.side, f.main),
    { kind: "ok", value: false },
    "not an ancestor",
  );
  equal(
    await backend.isAncestor(ref, f.side, f.merge),
    { kind: "ok", value: true },
    "ancestor by a second parent",
  );
  equal(
    await backend.isAncestor(ref, f.main, f.main),
    { kind: "ok", value: true },
    "a commit is its own ancestor",
  );
};
