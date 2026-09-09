import {
  type RegistryRequest,
  RegistryTransport,
} from "../../src/api/services/RegistryTransport.ts";

/**
 * A container registry, recorded.
 *
 * Substituted for the real transport through `Alepha.with({ provide, use })`,
 * never `vi.mock`: the seam is a class, so a spec drives the four answers the
 * same way ghcr does, and **nothing here reaches the network or needs a
 * credential**. That is the whole reason `ImageRegistryClient` does not call
 * `fetch` itself.
 *
 * Answers are matched by URL substring, so a case can say
 * `/manifests/0.30.0` without repeating the host and repository.
 *
 * ⚠️ **The LAST registration wins.** A case normally calls `healthy()` and
 * then overrides one of its four documents, and "first wins" would make that
 * override silently do nothing while the spec still passed for the wrong
 * reason.
 */
export class MemoryRegistryTransport extends RegistryTransport {
  public readonly answers = new Map<string, RegistryAnswer>();

  /**
   * Every URL asked for, in order, with the headers it was asked with.
   *
   * The contract is which calls are made and what they carry, not only what
   * they answered: "never a fifth call" and "the bearer does not cross the
   * redirect" are both assertions about THIS.
   */
  public readonly calls: Array<{
    url: string;
    headers: Record<string, string>;
  }> = [];

  /**
   * What an unregistered URL answers. A 404, because a spec that forgot to
   * record a document should read as a missing document rather than as a
   * silently empty one.
   */
  public fallback: RegistryAnswer = { status: 404, body: "" };

  override async fetch(url: string, init: RegistryRequest): Promise<Response> {
    this.calls.push({ url, headers: init.headers });

    const match = [...this.answers.entries()]
      .toReversed()
      .find(([suffix]) => url.includes(suffix));
    const answer = match?.[1] ?? this.fallback;

    const headers = new Headers(answer.headers ?? {});
    // ⚠️ A 3xx with a body is what makes `redirect: "manual"` observable at
    // all: `Response` refuses a body on a 204/304, and a 307 is fine.
    return new Response(answer.status === 204 ? null : (answer.body ?? ""), {
      status: answer.status,
      headers,
    });
  }

  /**
   * Record one answer. Chainable, because a case usually records four.
   */
  public on(suffix: string, answer: RegistryAnswer): this {
    this.answers.set(suffix, answer);
    return this;
  }

  /**
   * The four documents a healthy multi-arch ghcr tag answers with.
   *
   * ⚠️ The digest lives in `Docker-Content-Digest` on the tag's response and
   * nowhere else, which is how the real thing reports it and is why the
   * client reads that header rather than the index's own body.
   */
  public healthy(
    options: {
      repository?: string;
      tag?: string;
      digest?: string;
      runtime?: string;
      index?: string;
      manifest?: string;
      labels?: Record<string, string> | null;
    } = {},
  ): this {
    const repository = options.repository ?? "alepha-dev/lore";
    const tag = options.tag ?? "0.30.0";
    const digest = options.digest ?? `sha256:${"a".repeat(64)}`;
    const child = `sha256:${"b".repeat(64)}`;

    const labels =
      options.labels === null
        ? {}
        : (options.labels ?? {
            "dev.alepha.runtime": options.runtime ?? "node",
          });

    return this.on("/token", {
      status: 200,
      body: JSON.stringify({ token: "anonymous-token" }),
    })
      .on(`/${repository}/manifests/${tag}`, {
        status: 200,
        headers: { "docker-content-digest": digest },
        body: options.index ?? ociIndex(child),
      })
      .on(`/manifests/${child}`, {
        status: 200,
        body: options.manifest ?? childManifest(),
      })
      .on("/blobs/", {
        status: 200,
        body: JSON.stringify({ config: { Labels: labels } }),
      });
  }
}

export interface RegistryAnswer {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * A two-platform OCI index, plus the attestation entry buildx attaches by
 * default - which carries `architecture: "unknown"` and no runnable image.
 */
export const ociIndex = (amd64: string): string =>
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        digest: `sha256:${"c".repeat(64)}`,
        platform: { os: "linux", architecture: "arm64" },
      },
      { digest: amd64, platform: { os: "linux", architecture: "amd64" } },
      {
        digest: `sha256:${"d".repeat(64)}`,
        platform: { os: "unknown", architecture: "unknown" },
      },
    ],
  });

/**
 * A single-architecture manifest, with the sizes the client sums.
 */
export const childManifest = (): string =>
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { digest: `sha256:${"e".repeat(64)}`, size: 2_000 },
    layers: [{ size: 30_000_000 }, { size: 12_000_000 }],
  });

/**
 * A Docker manifest LIST, the other shape a multi-arch tag answers with.
 */
export const dockerManifestList = (amd64: string): string =>
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.list.v2+json",
    manifests: [
      { digest: amd64, platform: { os: "linux", architecture: "amd64" } },
    ],
  });
