import { $inject } from "alepha";
import { BadRequestError } from "alepha/server";

import { isAllowedRegistryHost } from "../schemas/registryHosts.ts";
import { RegistryTransport } from "./RegistryTransport.ts";

/**
 * Reads an image's own claims out of a registry, and refuses what it cannot.
 *
 * `ArtifactTarReader` is the shape this follows: the artifact's own document
 * is the source of truth, the pusher's word is not evidence, and every failure
 * is refused by its own name rather than as "push failed". The difference is
 * where the document lives - inside a tarball there, behind four HTTP calls
 * here - and that difference is the whole risk surface below.
 *
 * ## ⚠️ The reference is UNTRUSTED INPUT that decides which host is called
 *
 * Nothing else in Lore takes a caller-supplied string and calls the host it
 * names. Any project member can reach this. So {@link parse} runs to
 * completion, and refuses, BEFORE any fetch: shape, an exact-match host
 * allowlist, no port, no IP literal, no scheme, no digest reference. A
 * suffix match would be defeated by `evil-ghcr.io` and by
 * `ghcr.io.attacker.test`; the allowlist is exact and lives in
 * `schemas/registryHosts.ts`, where the second entry will be a reviewed
 * decision rather than an edited condition.
 *
 * ## Four calls, and never five
 *
 * 1. **Token.** ghcr requires an exchange even for an anonymous pull of a
 *    public repository. Skipping it is the first thing that looks like a 401
 *    bug. It sits behind {@link token} so a later epic can return an
 *    authenticated token without reshaping anything below it.
 * 2. **The tag**, with all four index and manifest media types in `Accept`.
 *    A multi-arch tag answers an index or a manifest list; a single-arch tag
 *    answers a plain manifest. buildx has produced both shapes across
 *    versions and all of them are valid input.
 * 3. **One child manifest**, for the index case only, chosen deterministically.
 * 4. **The config blob**, whose `.config.Labels` carries `dev.alepha.runtime`.
 *
 * There is no fifth. {@link sizeOf} is computed from a document already in
 * hand or not at all: a number in a table cell is not worth a round trip to a
 * system Lore does not control, and an index naming a hundred platforms must
 * not become a hundred fetches.
 *
 * ## Budgets, because a registry is a remote system Lore does not control
 *
 * {@link MAX_CALLS} bounds the fetches (redirect hops included) and
 * {@link MAX_DOCUMENT_BYTES} bounds each response, read through the stream so
 * a body with no `content-length` cannot grow past it either. A hostile or
 * broken registry is a fast refusal rather than a Worker that grows.
 */
export class ImageRegistryClient {
  protected readonly transport = $inject(RegistryTransport);

  /**
   * The label an Alepha-built image carries, written by
   * `BuildDockerTask.runtimeLabel` into every generated Dockerfile.
   *
   * ⚠️ Runtime appears NOWHERE in an OCI index, so a registry cannot answer
   * it and the pusher's word for it is not evidence. This label is the whole
   * reason `lore artifacts push-image` needs no `--runtime` flag, exactly as
   * `lore artifacts push` needs none.
   */
  public static readonly RUNTIME_LABEL = "dev.alepha.runtime";

  /**
   * Every shape a tag may legitimately answer with.
   *
   * All four, always, in one `Accept`. Sending only the index types makes a
   * single-arch tag look like a broken registry; sending only the manifest
   * types gets a multi-arch tag's index anyway on some registries and not on
   * others.
   */
  protected static readonly ACCEPT = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(", ");

  /**
   * The architecture picked when an index offers several.
   *
   * ⚠️ Deterministic, and named in the error when the config cannot be read,
   * so "which arch did it look at" is never a second round trip.
   */
  protected static readonly PREFERRED_PLATFORM = { os: "linux", arch: "amd64" };

  /**
   * How many fetches one `read` may make, redirect hops included.
   *
   * Four is the honest count (token, tag, child, config). The slack is for
   * the blob redirect ghcr always answers with, and the ceiling is what makes
   * a registry that answers 307 in a loop a fast refusal.
   */
  protected static readonly MAX_CALLS = 8;

  /**
   * How large any one registry document may be.
   *
   * An OCI index is about a kilobyte and a config blob a few. Anything near
   * this is not a document Lore has any use for, and the `manifest` column it
   * would land in caps at 64 KB anyway.
   */
  protected static readonly MAX_DOCUMENT_BYTES = 256 * 1024;

  /**
   * How many entries of an index will be considered when choosing a child.
   *
   * Bounded separately from the bytes: a small document can still name a
   * great many platforms, and only one of them is ever fetched.
   */
  protected static readonly MAX_INDEX_ENTRIES = 64;

  /**
   * Everything Lore records about an image, read from the image itself.
   *
   * The only input is the reference. There is no `runtime` parameter and no
   * `platform` parameter, and there must never be one: the first is in the
   * config blob's labels and the second is inside the index, and neither is
   * the pusher's to declare.
   */
  public async read(
    reference: string,
    expected?: { digest?: string },
  ): Promise<ImageDescriptor> {
    const parsed = this.parse(reference);
    const budget = { calls: 0 };
    const token = await this.token(parsed, budget);

    const top = await this.document(
      `https://${parsed.host}/v2/${parsed.repository}/manifests/${encodeURIComponent(parsed.tag)}`,
      { accept: ImageRegistryClient.ACCEPT, token, budget },
      `${parsed.repository}:${parsed.tag}`,
    );

    const digest = this.normalizeDigest(
      top.digestHeader ?? this.parsed(top.text, parsed).digest,
      parsed,
    );

    // ⚠️ As early as the digest is known, and BEFORE the two calls below.
    // A caller that says which bytes it pushed is asking Lore to check them,
    // and checking after fetching everything else spends two calls to reach
    // the same refusal.
    this.assertExpected(digest, expected?.digest, parsed);

    const child = await this.child(parsed, top, token, budget);

    const config = await this.config(parsed, child, token, budget);
    const runtime = this.runtimeOf(config, parsed, child.platform);

    return {
      reference: parsed.reference,
      host: parsed.host,
      repository: parsed.repository,
      tag: parsed.tag,
      digest,
      runtime,
      // ⚠️ The TOP document, which is the index for a multi-arch tag: the
      // per-architecture digests and the platform list already live in it,
      // which is exactly why no `arch` column exists.
      document: top.text,
      size: this.sizeOf(child.manifest),
    };
  }

  /**
   * Split a reference into `(host, repository, tag)`, or refuse it.
   *
   * ⚠️ **Everything here happens before the first fetch.** This is the guard
   * on a caller-supplied destination, not a formatting convenience.
   */
  public parse(reference: string): ParsedReference {
    const raw = reference.trim();
    if (!raw) {
      throw new BadRequestError("An image reference is required.");
    }
    if (raw.length > 512) {
      throw new BadRequestError(
        "That image reference is longer than 512 characters, which is the column's ceiling.",
      );
    }
    if (raw.includes("://")) {
      throw new BadRequestError(
        `Invalid image reference "${raw}": write it as \`host/repository:tag\`, with no scheme. Lore always uses https.`,
      );
    }
    if (raw.includes("@")) {
      // Refused by name rather than half-supported. A digest reference names
      // no tag, so `artifacts.tag` would have to come from somewhere else and
      // the row's identity would stop matching what a `docker pull` of the
      // recorded string fetches.
      throw new BadRequestError(
        `Invalid image reference "${raw}": a digest reference (\`@sha256:...\`) is not supported. Name the tag, and pass the digest as \`digest\` if you want it checked.`,
      );
    }

    const slash = raw.indexOf("/");
    if (slash <= 0) {
      throw new BadRequestError(
        `Invalid image reference "${raw}": expected \`host/repository:tag\`, for example \`ghcr.io/alepha-dev/lore:0.30.0\`.`,
      );
    }
    const host = raw.slice(0, slash).toLowerCase();
    const rest = raw.slice(slash + 1);

    const colon = rest.lastIndexOf(":");
    if (colon <= 0 || colon === rest.length - 1) {
      throw new BadRequestError(
        `Invalid image reference "${raw}": no tag. Name one explicitly, for example \`${host}/${rest}:0.30.0\`.`,
      );
    }
    const repository = rest.slice(0, colon);
    const tag = rest.slice(colon + 1);

    // ⚠️ Before the port check, which would otherwise claim `[::1]` and
    // `::1` are ports: an IPv6 literal is all colons, and the refusal has to
    // name what is actually wrong with it.
    if (this.isIpLiteral(host)) {
      throw new BadRequestError(
        `Invalid image reference "${raw}": the registry must be named by hostname, never by IP address.`,
      );
    }
    if (host.includes(":")) {
      // Not merely unsupported: a port is how a reference reaches a service
      // that is not the registry it names, including one inside the network
      // the Worker runs in.
      throw new BadRequestError(
        `Invalid image reference "${raw}": a port is not allowed in the registry host.`,
      );
    }
    if (!isAllowedRegistryHost(host)) {
      throw new BadRequestError(
        `Lore does not read images from "${host}". Only \`ghcr.io\` is supported today; a custom registry needs credential storage as well as an entry in the host list.`,
      );
    }
    if (!ImageRegistryClient.REPOSITORY.test(repository)) {
      throw new BadRequestError(
        `Invalid repository "${repository}": lowercase letters, digits, and interior \`.\`, \`_\`, \`-\` or \`/\` only.`,
      );
    }
    if (!ImageRegistryClient.TAG.test(tag)) {
      throw new BadRequestError(
        `Invalid image tag "${tag}": letters, digits, and interior \`.\`, \`_\` or \`-\` only.`,
      );
    }

    return { reference: raw, host, repository, tag };
  }

  /**
   * A bearer for this repository.
   *
   * ## ⚠️ The seam the later custom-registry epic needs
   *
   * Anonymous TODAY, and the shape is deliberately not "the anonymous token
   * exchange": it takes the parsed reference and returns a bearer, so an
   * implementation that looks up a stored credential for the host slots in
   * without touching a single call site below. Nothing in this class may
   * assume anonymous access is the only mode - that assumption is what would
   * make the later epic a rewrite rather than an override.
   *
   * ghcr requires this even to pull a PUBLIC repository anonymously. Skipping
   * it is the first thing that will look like a 401 bug.
   */
  protected async token(
    parsed: ParsedReference,
    budget: CallBudget,
  ): Promise<string> {
    const url =
      `https://${parsed.host}/token` +
      `?scope=${encodeURIComponent(`repository:${parsed.repository}:pull`)}` +
      `&service=${encodeURIComponent(parsed.host)}`;

    const response = await this.call(
      url,
      { accept: "application/json" },
      budget,
    );
    if (!response.ok) {
      throw new BadRequestError(
        `The token exchange with ${parsed.host} failed (HTTP ${response.status}). The repository \`${parsed.repository}\` may be private, and Lore holds no registry credentials.`,
      );
    }

    const body = await this.text(response, `${parsed.host} token`);
    let json: { token?: unknown; access_token?: unknown };
    try {
      json = JSON.parse(body);
    } catch {
      throw new BadRequestError(
        `${parsed.host} answered the token exchange with something that is not JSON.`,
      );
    }
    const token = json.token ?? json.access_token;
    if (typeof token !== "string" || !token) {
      throw new BadRequestError(
        `${parsed.host} answered the token exchange with no token.`,
      );
    }
    return token;
  }

  /**
   * The child manifest to read the config from, and the platform it names.
   *
   * A single-arch tag answers a plain manifest and IS its own child, which is
   * what keeps the call count at three in that case. An index is resolved to
   * exactly one entry - `linux/amd64` when it is offered, otherwise the first
   * one - and the choice is carried out so a config failure can name it.
   */
  protected async child(
    parsed: ParsedReference,
    top: RegistryDocument,
    token: string,
    budget: CallBudget,
  ): Promise<ChosenChild> {
    const document = this.parsed(top.text, parsed);
    const entries = document.manifests;

    if (!entries) {
      // Not an index: the tag answered a plain manifest, so it is the child.
      return { manifest: document, platform: "the tag's own manifest" };
    }
    if (!entries.length) {
      throw new BadRequestError(
        `${parsed.reference} is an index that names no image at all.`,
      );
    }
    if (entries.length > ImageRegistryClient.MAX_INDEX_ENTRIES) {
      throw new BadRequestError(
        `${parsed.reference} is an index naming ${entries.length} manifests, past the ${ImageRegistryClient.MAX_INDEX_ENTRIES} Lore will consider.`,
      );
    }

    const { os, arch } = ImageRegistryClient.PREFERRED_PLATFORM;
    const runnable = entries.filter(
      // ⚠️ `attestation-manifest` entries carry `platform.architecture:
      // "unknown"` and no runnable image. buildx attaches them by default, and
      // taking one as "the first entry" reads a config blob with no labels.
      (it) =>
        it.platform?.architecture && it.platform.architecture !== "unknown",
    );
    const pool = runnable.length ? runnable : entries;
    const chosen =
      pool.find(
        (it) => it.platform?.os === os && it.platform?.architecture === arch,
      ) ?? pool[0];

    const platform = chosen.platform
      ? `${chosen.platform.os ?? "?"}/${chosen.platform.architecture ?? "?"}`
      : "an entry naming no platform";

    if (!chosen.digest) {
      throw new BadRequestError(
        `${parsed.reference} names a manifest for ${platform} with no digest.`,
      );
    }

    const fetched = await this.document(
      `https://${parsed.host}/v2/${parsed.repository}/manifests/${chosen.digest}`,
      { accept: ImageRegistryClient.ACCEPT, token, budget },
      `${parsed.reference} (${platform})`,
    );

    return { manifest: this.parsed(fetched.text, parsed), platform };
  }

  /**
   * The config blob of the chosen child, parsed.
   *
   * ⚠️ **The redirect is followed by hand, without the bearer.** ghcr answers
   * a blob request with a 307 to `pkg-containers.githubusercontent.com`;
   * letting `fetch` follow it re-sends the Authorization header to a host that
   * is not the registry. The transport is `redirect: "manual"` for exactly
   * this, and the hop is taken here with no credentials on it.
   */
  protected async config(
    parsed: ParsedReference,
    child: ChosenChild,
    token: string,
    budget: CallBudget,
  ): Promise<ImageConfig> {
    const digest = child.manifest.config?.digest;
    if (!digest) {
      throw new BadRequestError(
        `${parsed.reference} names no config blob for ${child.platform}, so nothing states what runtime it holds.`,
      );
    }

    const text = await this.blob(parsed, digest, token, budget, child.platform);
    try {
      return JSON.parse(text) as ImageConfig;
    } catch {
      throw new BadRequestError(
        `${parsed.reference} has a config blob for ${child.platform} that is not JSON.`,
      );
    }
  }

  /**
   * A blob, through however many hops the registry answers with.
   */
  protected async blob(
    parsed: ParsedReference,
    digest: string,
    token: string,
    budget: CallBudget,
    platform: string,
  ): Promise<string> {
    let url = `https://${parsed.host}/v2/${parsed.repository}/blobs/${digest}`;
    let authorized = true;

    for (let hop = 0; hop <= ImageRegistryClient.MAX_REDIRECTS; hop++) {
      const response = await this.call(
        url,
        {
          accept: "application/json",
          ...(authorized ? { token } : {}),
        },
        budget,
      );

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new BadRequestError(
            `${parsed.host} redirected the config blob for ${platform} with no destination.`,
          );
        }
        url = this.assertHttps(new URL(location, url), parsed);
        // ⚠️ The credential does NOT cross the hop. ghcr's blob redirect goes
        // to a different host with the authorization already in its query
        // string, and re-sending the bearer there is handing a token to a
        // service that never asked for it.
        authorized = false;
        continue;
      }

      if (!response.ok) {
        throw new BadRequestError(
          `Could not read the config blob of ${parsed.reference} for ${platform} (HTTP ${response.status}).`,
        );
      }

      return await this.text(response, `${parsed.reference} config`);
    }

    throw new BadRequestError(
      `${parsed.host} redirected the config blob for ${platform} more than ${ImageRegistryClient.MAX_REDIRECTS} times.`,
    );
  }

  /**
   * The runtime this image states it holds.
   *
   * ⚠️ Absent is a REFUSAL, never a default of `node`. `runtime` is part of
   * this registry's unique key, so guessing it would file a bun image under
   * `node` and let the next push overwrite it - the same reason
   * `artifactManifestSchema` makes `runtime` required where the framework's
   * own manifest makes it optional.
   */
  protected runtimeOf(
    config: ImageConfig,
    parsed: ParsedReference,
    platform: string,
  ): string {
    const labels = config.config?.Labels ?? config.container_config?.Labels;
    const runtime = labels?.[ImageRegistryClient.RUNTIME_LABEL];
    if (typeof runtime !== "string" || !runtime.trim()) {
      throw new BadRequestError(
        `${parsed.reference} declares no \`${ImageRegistryClient.RUNTIME_LABEL}\` label on ${platform}, so nothing in it says what it runs. Images built by \`alepha build --target=docker\` carry it; one built another way, or before that label existed, has to be rebuilt.`,
      );
    }
    return runtime.trim();
  }

  /**
   * One architecture's compressed size, or nothing.
   *
   * ⚠️ **Best effort, and never a fifth call.** The chosen child manifest
   * already lists `config.size` and every `layers[].size`, so summing them is
   * free. When the document in hand does not answer it the size is absent and
   * every surface renders N/A: a number in a table cell is not worth a round
   * trip to a system Lore does not control, and neither is walking the other
   * architectures to add them up.
   *
   * ⚠️ What it MEANS is one architecture's compressed total, for a tag that
   * may carry two. Said here, on the column, and on the title attribute of
   * every cell that shows it, because a reader who is not told will take it
   * for the whole thing.
   */
  protected sizeOf(manifest: RegistryDocumentBody): number | undefined {
    const parts = [manifest.config, ...(manifest.layers ?? [])];
    let total = 0;
    for (const part of parts) {
      if (
        !part ||
        typeof part.size !== "number" ||
        !Number.isFinite(part.size)
      ) {
        return undefined;
      }
      total += part.size;
    }
    return parts.length ? total : undefined;
  }

  /**
   * Bare lowercase hex, with `sha256:` stripped.
   *
   * ⚠️ `artifacts.sha256` is `min(64).max(64)` and a registry reports
   * `sha256:<64 hex>`, which is 71 characters - an unnormalised value fails
   * the insert with a schema error that names nothing useful. A digest whose
   * algorithm is not sha256 is refused by NAME rather than truncated into
   * something that looks like a sha256 and is not.
   */
  public normalizeDigest(
    digest: string | undefined,
    parsed: ParsedReference,
  ): string {
    if (!digest) {
      throw new BadRequestError(
        `${parsed.host} reported no digest for ${parsed.reference}.`,
      );
    }
    const value = digest.trim();
    const colon = value.indexOf(":");
    if (colon === -1) {
      // Already bare, which is what a document's own `digest` field never is
      // but a hand-written value may be. Validate it the same way.
      return this.assertHex(value, parsed, digest);
    }
    const algorithm = value.slice(0, colon).toLowerCase();
    if (algorithm !== "sha256") {
      throw new BadRequestError(
        `${parsed.reference} is digested with \`${algorithm}\`, and Lore records sha256 only.`,
      );
    }
    return this.assertHex(value.slice(colon + 1), parsed, digest);
  }

  /**
   * A digest the caller claimed, checked against the one the registry
   * reports.
   *
   * ⚠️ **The branch is kept exercised even though `release.yml` sends
   * nothing.** The record step there sits at the END of the job, where a
   * `--metadata-file` value from minutes earlier would have to travel through
   * `$GITHUB_ENV` to guard against a re-tag that cannot happen inside one
   * job. Somebody else's CI may want it, and an unexercised branch is worse
   * than an unused field - so the field stays, and so does this spec.
   *
   * The claim is normalised the same way the registry's answer is, so
   * `sha256:AB...` and `ab...` are the same claim rather than a mismatch.
   */
  protected assertExpected(
    actual: string,
    claimed: string | undefined,
    parsed: ParsedReference,
  ): void {
    if (!claimed) {
      return;
    }
    const normalized = this.normalizeDigest(claimed, parsed);
    if (normalized !== actual) {
      throw new BadRequestError(
        `${parsed.reference} is ${actual.slice(0, 12)} in the registry, and the push claims ${normalized.slice(0, 12)}. The tag has moved, or the push names a different build.`,
      );
    }
  }

  protected assertHex(
    value: string,
    parsed: ParsedReference,
    original: string,
  ): string {
    const lower = value.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(lower)) {
      throw new BadRequestError(
        `${parsed.reference} reported the digest "${original}", which is not 64 hex characters of sha256.`,
      );
    }
    return lower;
  }

  /**
   * One registry document, fetched and parsed far enough to be trusted.
   */
  protected async document(
    url: string,
    options: { accept: string; token: string; budget: CallBudget },
    subject: string,
  ): Promise<RegistryDocument> {
    const response = await this.call(
      url,
      { accept: options.accept, token: options.token },
      options.budget,
    );

    if (response.status === 404) {
      throw new BadRequestError(
        `${subject} does not exist in the registry, or is not readable without a credential.`,
      );
    }
    if (!response.ok) {
      throw new BadRequestError(
        `The registry answered HTTP ${response.status} for ${subject}.`,
      );
    }

    return {
      text: await this.text(response, subject),
      digestHeader: response.headers.get("docker-content-digest") ?? undefined,
    };
  }

  /**
   * Every fetch goes through here, so the call budget cannot be bypassed by
   * adding a code path.
   */
  protected async call(
    url: string,
    headers: { accept: string; token?: string },
    budget: CallBudget,
  ): Promise<Response> {
    budget.calls += 1;
    if (budget.calls > ImageRegistryClient.MAX_CALLS) {
      throw new BadRequestError(
        `Reading that image took more than ${ImageRegistryClient.MAX_CALLS} registry calls, which is more than any real image needs.`,
      );
    }

    try {
      return await this.transport.fetch(url, {
        headers: {
          accept: headers.accept,
          "user-agent": ImageRegistryClient.USER_AGENT,
          ...(headers.token
            ? { authorization: `Bearer ${headers.token}` }
            : {}),
        },
      });
    } catch (error) {
      throw new BadRequestError(
        `Could not reach the registry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * A response body, read through the stream against a byte budget.
   *
   * ⚠️ Not `response.text()` with a length check afterwards: that has already
   * held the whole body by the time the check runs, and a registry that
   * answers with no `content-length` chooses how much memory a push costs.
   */
  protected async text(response: Response, subject: string): Promise<string> {
    const declared = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declared) &&
      declared > ImageRegistryClient.MAX_DOCUMENT_BYTES
    ) {
      throw new BadRequestError(
        `The registry's answer for ${subject} declares ${declared} bytes, past the ${ImageRegistryClient.MAX_DOCUMENT_BYTES} Lore will read.`,
      );
    }

    const body = response.body;
    if (!body) {
      return "";
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        total += value.byteLength;
        if (total > ImageRegistryClient.MAX_DOCUMENT_BYTES) {
          throw new BadRequestError(
            `The registry's answer for ${subject} is past the ${ImageRegistryClient.MAX_DOCUMENT_BYTES} bytes Lore will read.`,
          );
        }
        chunks.push(value);
      }
    } finally {
      // ⚠️ Only on the way out normally: cancelling a stream that already
      // errored rejects with that same error and buries the real one, which
      // is the trap `ArtifactTarReader` records.
      reader.releaseLock();
    }

    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
  }

  /**
   * A registry document's JSON, or a refusal naming the reference.
   */
  protected parsed(
    text: string,
    parsed: ParsedReference,
  ): RegistryDocumentBody {
    try {
      const value = JSON.parse(text) as RegistryDocumentBody;
      if (!value || typeof value !== "object") {
        throw new Error("not an object");
      }
      return value;
    } catch {
      throw new BadRequestError(
        `${parsed.host} answered for ${parsed.reference} with something that is not a registry document.`,
      );
    }
  }

  /**
   * A redirect destination Lore will follow.
   *
   * The registry allowlist deliberately does NOT apply here: ghcr's own blob
   * redirect goes to `pkg-containers.githubusercontent.com`, which is not a
   * registry. What does apply is https and no embedded credentials - the hop
   * is taken with no bearer, and a `http://` destination would put the
   * pre-signed URL it carries on the wire in clear.
   */
  protected assertHttps(url: URL, parsed: ParsedReference): string {
    if (url.protocol !== "https:") {
      throw new BadRequestError(
        `${parsed.host} redirected the config blob to a \`${url.protocol}\` URL, and Lore follows https only.`,
      );
    }
    if (url.username || url.password) {
      throw new BadRequestError(
        `${parsed.host} redirected the config blob to a URL carrying credentials.`,
      );
    }
    return url.toString();
  }

  /**
   * Whether the host is an IP address rather than a name.
   *
   * ⚠️ Two or more colons for the bare IPv6 case, never one: a single colon
   * is a PORT, and treating `ghcr.io:5000` as an IP literal refuses it with a
   * message about the wrong thing.
   */
  protected isIpLiteral(host: string): boolean {
    return (
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.startsWith("[") ||
      (host.match(/:/g)?.length ?? 0) >= 2
    );
  }

  protected static readonly MAX_REDIRECTS = 3;

  protected static readonly USER_AGENT = "lore-artifact-registry";

  /**
   * A docker repository path: at least one segment, lowercase.
   */
  protected static readonly REPOSITORY =
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;

  /**
   * A docker tag, matching the registry's own rule: 128 characters, opening
   * with a word character.
   */
  protected static readonly TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
}

export interface ParsedReference {
  /**
   * The reference exactly as it arrived, trimmed. This is what the row
   * records and what a page renders, so it must not be reassembled from the
   * parts: a project that writes `GHCR.io/...` gets its own spelling back.
   */
  reference: string;
  host: string;
  repository: string;
  tag: string;
}

/**
 * What `ArtifactService.pushImage` writes to the row.
 */
export interface ImageDescriptor {
  reference: string;
  host: string;
  repository: string;
  tag: string;
  /**
   * Bare lowercase hex, `sha256:` already stripped.
   */
  digest: string;
  runtime: string;
  /**
   * The OCI index (or manifest list, or single-arch manifest) as the registry
   * answered it, which is what `artifacts.manifest` stores for an image.
   */
  document: string;
  /**
   * One architecture's compressed size, when the document in hand answered
   * it. Absent otherwise, and absent is normal.
   */
  size?: number;
}

interface CallBudget {
  calls: number;
}

interface RegistryDocument {
  text: string;
  digestHeader?: string;
}

interface RegistryDocumentBody {
  digest?: string;
  manifests?: Array<{
    digest?: string;
    platform?: { os?: string; architecture?: string };
  }>;
  config?: { digest?: string; size?: number };
  layers?: Array<{ size?: number }>;
}

interface ChosenChild {
  manifest: RegistryDocumentBody;
  platform: string;
}

interface ImageConfig {
  config?: { Labels?: Record<string, string> };
  container_config?: { Labels?: Record<string, string> };
}
