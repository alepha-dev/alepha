/**
 * The contract test of `ArtifactsGitBackend` against a REAL Artifacts
 * namespace (#Q3928), run by hand, never by Verify: a fake cannot disagree.
 *
 * The backend speaks to the Workers binding, which exists only inside a
 * Worker, so this hands it a binding built over Artifacts' REST API: the same
 * service, the same names, tokens and remotes. Then it does what Lore does
 * with them: create a repository named by id, mint a write token, `git push`
 * to the remote, mint a read token, `git clone` it back, compare HEAD, and
 * delete it.
 *
 *   ARTIFACTS_ACCOUNT_ID=... ARTIFACTS_API_TOKEN=... \
 *   ARTIFACTS_NAMESPACE=lore-contract node test/artifacts-contract.ts
 *
 * The token needs Artifacts > Edit on the account. The namespace should be a
 * throwaway one: every run leaves a deleted name behind, which Artifacts does
 * not let anyone reuse for a while.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";

import { Alepha, AlephaError } from "alepha";

import {
  type ArtifactsBinding,
  ArtifactsGitBackend,
  type ArtifactsRepoHandle,
} from "../src/api/backends/ArtifactsGitBackend.ts";
import {
  assertGitBackendContract,
  buildContractFixture,
  pushContractFixture,
} from "./git-backend-contract.ts";

class RestArtifactsBinding implements ArtifactsBinding {
  protected readonly account: string;
  protected readonly token: string;
  protected readonly namespace: string;

  constructor(account: string, token: string, namespace: string) {
    this.account = account;
    this.token = token;
    this.namespace = namespace;
  }

  protected async call(method: string, path: string, body?: unknown) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.account}/artifacts/namespaces/${this.namespace}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const json = (await response.json()) as {
      success: boolean;
      result: any;
      errors: Array<{ message: string }>;
    };
    if (!json.success) {
      const message = json.errors.map((it) => it.message).join("; ");
      throw Object.assign(new AlephaError(`${method} ${path}: ${message}`), {
        code: response.status === 404 ? "NOT_FOUND" : undefined,
      });
    }
    return json.result;
  }

  /**
   * A route that answers raw bytes (`/blob/:hash`), or null on a 404.
   */
  protected async raw(path: string): Promise<Blob | null> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.account}/artifacts/namespaces/${this.namespace}${path}`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AlephaError(`GET ${path}: ${response.status}`);
    }
    return new Blob([await response.arrayBuffer()]);
  }

  async create(name: string, options?: { setDefaultBranch?: string }) {
    return this.call("POST", "/repos", {
      name,
      default_branch: options?.setDefaultBranch,
    });
  }

  async get(name: string): Promise<ArtifactsRepoHandle> {
    await this.call("GET", `/repos/${name}`);
    return {
      info: async () => {
        const info = await this.call("GET", `/repos/${name}`);
        return {
          defaultBranch: info.default_branch ?? info.defaultBranch,
          remote: info.remote,
        };
      },
      createToken: async (scope, ttl) => {
        const minted = await this.call("POST", "/tokens", {
          repo: name,
          scope,
          ttl,
        });
        return { plaintext: minted.plaintext, expiresAt: minted.expires_at };
      },
      log: async (options) => {
        const query = new URLSearchParams({
          ref: options.ref ?? "HEAD",
          limit: String(options.limit ?? 50),
          offset: String(options.offset ?? 0),
        });
        return this.call("GET", `/repos/${name}/log?${query}`);
      },
      readCommit: async (hash) => {
        try {
          return await this.call("GET", `/repos/${name}/commit/${hash}`);
        } catch {
          return null;
        }
      },
      readTree: async (hash) => {
        try {
          return await this.call("GET", `/repos/${name}/tree/${hash}`);
        } catch {
          return null;
        }
      },
      readBlob: (hash) => this.raw(`/repos/${name}/blob/${hash}`),
    };
  }

  async list(options?: { cursor?: string }) {
    const repos = await this.call(
      "GET",
      `/repos${options?.cursor ? `?cursor=${options.cursor}` : ""}`,
    );
    return { repos: repos as Array<{ name: string }> };
  }

  async delete(name: string) {
    return this.call("DELETE", `/repos/${name}`);
  }
}

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new AlephaError(`${name} is required`);
  return value;
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/**
 * `git` without blocking the event loop, for a push through the local
 * `serve` front, which answers in this same process.
 */
const gitAsync = (cwd: string, ...args: string[]) =>
  promisify(execFile)("git", args, { cwd, encoding: "utf8" });

const withToken = (remote: string, token: string) => {
  const url = new URL(remote);
  url.username = "x";
  url.password = token;
  return url.toString();
};

const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
alepha.set(
  "cloudflare.env" as never,
  {
    ARTIFACTS: new RestArtifactsBinding(
      env("ARTIFACTS_ACCOUNT_ID"),
      env("ARTIFACTS_API_TOKEN"),
      process.env.ARTIFACTS_NAMESPACE ?? "lore-contract",
    ),
  } as never,
);
const backend = alepha.inject(ArtifactsGitBackend);
const ref = backend.refFor({ projectId: 0, repoId: crypto.randomUUID() });
// A second repository for the reads, whose history is the fixture's alone.
const readsRef = backend.refFor({ projectId: 0, repoId: crypto.randomUUID() });
const work = mkdtempSync(join(tmpdir(), "artifacts-contract-"));

try {
  await backend.create(ref, { defaultBranch: "main" });
  console.log(`created ${ref}`);
  const info = await backend.info(ref);
  if (info?.defaultBranch !== "main") {
    throw new AlephaError(`default branch is ${info?.defaultBranch}`);
  }

  const source = join(work, "source");
  git(work, "init", "--quiet", "-b", "main", source);
  writeFileSync(join(source, "README.md"), "contract\n");
  git(source, "add", "README.md");
  git(
    source,
    "-c",
    "user.name=lore",
    "-c",
    "user.email=lore@example.com",
    "commit",
    "--quiet",
    "-m",
    "contract",
  );
  const head = git(source, "rev-parse", "HEAD");

  const write = await backend.token(ref, "write");
  if (!write) throw new AlephaError("no write token");
  git(source, "push", "--quiet", withToken(write.remote, write.token), "main");
  console.log(`pushed ${head}`);

  // Through `serve`, as Lore's git route calls it, the default branch named.
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://lore.test");
    const advertise = url.pathname.endsWith("/info/refs");
    const service = (
      advertise
        ? url.searchParams.get("service")
        : url.pathname.split("/").pop()
    ) as "git-upload-pack" | "git-receive-pack";
    const response = await backend.serve(ref, {
      service,
      advertise,
      body: advertise
        ? undefined
        : (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>),
      gitProtocol: req.headers["git-protocol"] as string | undefined,
      userAgent: req.headers["user-agent"],
      defaultBranch: "main",
    });
    res.statusCode = response.status;
    if (response.contentType)
      res.setHeader("content-type", response.contentType);
    if (typeof response.body === "string") res.end(response.body);
    else Readable.fromWeb(response.body as never).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const lore = `http://127.0.0.1:${(server.address() as AddressInfo).port}/r.git`;
  const commitFile = (cwd: string, name: string) => {
    writeFileSync(join(cwd, `${name}.txt`), `${name}\n`);
    git(cwd, "add", `${name}.txt`);
    git(
      cwd,
      "-c",
      "user.name=lore",
      "-c",
      "user.email=lore@example.com",
      "commit",
      "--quiet",
      "-m",
      name,
    );
    return git(cwd, "rev-parse", "HEAD");
  };
  const remoteRefs = () =>
    git(work, "ls-remote", withToken(write.remote, write.token))
      .split("\n")
      .filter((line) => !line.endsWith("\tHEAD"));
  const expectRefs = (expected: string[], step: string) => {
    const refs = remoteRefs();
    if (JSON.stringify(refs) !== JSON.stringify(expected)) {
      throw new AlephaError(`${step}: refs are ${JSON.stringify(refs)}`);
    }
    console.log(`${step}: ok`);
  };
  try {
    const forward = commitFile(source, "forward");
    await gitAsync(source, "push", "--quiet", lore, "main");
    expectRefs([`${forward}\trefs/heads/main`], "fast-forward");

    git(source, "reset", "--quiet", "--hard", head);
    commitFile(source, "rewritten");
    const forced = await gitAsync(source, "push", "--force", lore, "main").then(
      () => undefined,
      (error: { stderr?: string }) => String(error.stderr),
    );
    if (!forced?.includes("refuses a non-fast-forward push")) {
      throw new AlephaError(`force-push was not refused: ${forced}`);
    }
    expectRefs([`${forward}\trefs/heads/main`], "force-push refused");

    git(source, "merge", "--quiet", "--no-edit", "-X", "theirs", forward);
    const merge = git(source, "rev-parse", "HEAD");
    await gitAsync(source, "push", "--quiet", lore, "main");
    expectRefs([`${merge}\trefs/heads/main`], "second-parent fast-forward");
  } finally {
    server.close();
  }

  const read = await backend.token(ref, "read");
  if (!read) throw new AlephaError("no read token");
  const again = await backend.token(ref, "read");
  if (again?.token !== read.token) {
    throw new AlephaError("the read token was minted twice");
  }
  git(work, "clone", "--quiet", withToken(read.remote, read.token), "clone");
  const cloned = git(join(work, "clone"), "rev-parse", "HEAD");
  const pushed = git(source, "rev-parse", "HEAD");
  if (cloned !== pushed) {
    throw new AlephaError(`cloned HEAD ${cloned}, pushed ${pushed}`);
  }
  console.log(`cloned ${cloned}`);

  // The reads (#Q4131): the same assertions Vitest runs on disk.
  await backend.create(readsRef, { defaultBranch: "main" });
  const readsWrite = await backend.token(readsRef, "write");
  if (!readsWrite) throw new AlephaError("no write token for the reads");
  const fixture = buildContractFixture(join(work, "reads"));
  pushContractFixture(
    join(work, "reads"),
    fixture,
    withToken(readsWrite.remote, readsWrite.token),
  );
  await assertGitBackendContract(backend, readsRef, fixture);
  console.log("reads: ok");

  // A branch deleted where it points (#Q4137), refused once it moved.
  await backend.deleteRef(readsRef, "refs/heads/merged", fixture.side).then(
    () => {
      throw new AlephaError("a stale delete was taken");
    },
    () => undefined,
  );
  await backend.deleteRef(readsRef, "refs/heads/merged", fixture.merge);
  if (
    (await backend.refs(readsRef)).some(
      (tip) => tip.name === "refs/heads/merged",
    )
  ) {
    throw new AlephaError("the branch survived its delete");
  }
  console.log("deleteRef: ok");

  if (!(await backend.list()).includes(ref)) {
    throw new AlephaError(`${ref} is not listed`);
  }
} finally {
  await backend.delete(ref);
  await backend.delete(ref);
  await backend.delete(readsRef);
  console.log(`deleted ${ref}`);
  rmSync(work, { recursive: true, force: true });
}

console.log("Artifacts contract OK");
