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
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, AlephaError } from "alepha";

import {
  type ArtifactsBinding,
  ArtifactsGitBackend,
  type ArtifactsRepoHandle,
} from "../src/api/backends/ArtifactsGitBackend.ts";

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

  const read = await backend.token(ref, "read");
  if (!read) throw new AlephaError("no read token");
  const again = await backend.token(ref, "read");
  if (again?.token !== read.token) {
    throw new AlephaError("the read token was minted twice");
  }
  git(work, "clone", "--quiet", withToken(read.remote, read.token), "clone");
  const cloned = git(join(work, "clone"), "rev-parse", "HEAD");
  if (cloned !== head) {
    throw new AlephaError(`cloned HEAD ${cloned}, pushed ${head}`);
  }
  console.log(`cloned ${cloned}`);

  if (!(await backend.list()).includes(ref)) {
    throw new AlephaError(`${ref} is not listed`);
  }
} finally {
  await backend.delete(ref);
  await backend.delete(ref);
  console.log(`deleted ${ref}`);
  rmSync(work, { recursive: true, force: true });
}

console.log("Artifacts contract OK");
