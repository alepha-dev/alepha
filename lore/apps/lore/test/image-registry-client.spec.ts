import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { ImageRegistryClient } from "../src/api/services/ImageRegistryClient.ts";
import { RegistryTransport } from "../src/api/services/RegistryTransport.ts";
import {
  childManifest,
  dockerManifestList,
  MemoryRegistryTransport,
} from "./fixtures/MemoryRegistryTransport.ts";

/**
 * The half of an image push that turns a claim into a fact.
 *
 * ⚠️ **No network and no credential.** Every case here drives
 * `MemoryRegistryTransport`, which is substituted through
 * `Alepha.with({ provide, use })`. A spec that needed ghcr to be reachable
 * would be a spec that stops running the day GitHub has an incident, and one
 * that needed a token could not run in CI at all.
 */
const setup = () => {
  const alepha = Alepha.create().with({
    provide: RegistryTransport,
    use: MemoryRegistryTransport,
  });
  return {
    client: alepha.inject(ImageRegistryClient),
    registry: alepha.inject(MemoryRegistryTransport),
  };
};

const REFERENCE = "ghcr.io/alepha-dev/lore:0.30.0";

describe("ImageRegistryClient", () => {
  /**
   * The reference decides which host the Worker then calls, and any project
   * member can supply one. Nothing else in Lore has that shape, so every one
   * of these refusals happens BEFORE the first fetch.
   */
  describe("parsing the reference, before any fetch", () => {
    it("splits a well-formed reference into host, repository and tag", ({
      expect,
    }) => {
      const { client } = setup();

      expect(client.parse(REFERENCE)).toEqual({
        reference: REFERENCE,
        host: "ghcr.io",
        repository: "alepha-dev/lore",
        tag: "0.30.0",
      });
    });

    it("keeps the reference verbatim, so a page renders what was pushed", ({
      expect,
    }) => {
      const { client } = setup();

      // Reassembling it from the parts would silently rewrite the host's
      // case, and the row is what a reader copies into `docker pull`.
      expect(
        client.parse("  ghcr.io/Acme/App:v1  ".replace(/A/g, "a")).reference,
      ).toBe("ghcr.io/acme/app:v1");
    });

    it("refuses a host that is not on the allowlist, by name", ({ expect }) => {
      const { client, registry } = setup();

      expect(() => client.parse("docker.io/library/node:24")).toThrowError(
        /Lore does not read images from "docker\.io"/,
      );
      // The refusal is the whole point: nothing was called.
      expect(registry.calls).toEqual([]);
    });

    it("refuses a lookalike host rather than matching a suffix", ({
      expect,
    }) => {
      const { client } = setup();

      // A suffix match is defeated by both of these, which is why the
      // allowlist is exact.
      expect(() => client.parse("evil-ghcr.io/acme/app:1")).toThrowError(
        /does not read images from/,
      );
      expect(() =>
        client.parse("ghcr.io.attacker.test/acme/app:1"),
      ).toThrowError(/does not read images from/);
    });

    it("refuses a digest reference by name rather than half-supporting it", ({
      expect,
    }) => {
      const { client } = setup();

      expect(() =>
        client.parse(`ghcr.io/alepha-dev/lore@sha256:${"a".repeat(64)}`),
      ).toThrowError(
        /a digest reference \(`@sha256:\.\.\.`\) is not supported/,
      );
    });

    it("refuses a port, an IP literal and a scheme", ({ expect }) => {
      const { client } = setup();

      expect(() => client.parse("ghcr.io:5000/acme/app:1")).toThrowError(
        /a port is not allowed/,
      );
      expect(() => client.parse("127.0.0.1/acme/app:1")).toThrowError(
        /never by IP address/,
      );
      expect(() => client.parse("[::1]/acme/app:1")).toThrowError(
        /never by IP address/,
      );
      expect(() => client.parse("https://ghcr.io/acme/app:1")).toThrowError(
        /with no scheme/,
      );
    });

    it("refuses a reference with no tag", ({ expect }) => {
      const { client } = setup();

      expect(() => client.parse("ghcr.io/alepha-dev/lore")).toThrowError(
        /no tag/,
      );
    });
  });

  describe("reading a healthy image", () => {
    it("returns the runtime, the bare digest, the index and the size", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy();

      const image = await client.read(REFERENCE);

      expect(image.runtime).toBe("node");
      // ⚠️ Bare hex: `artifacts.sha256` is exactly 64 characters and the
      // registry reports 71.
      expect(image.digest).toBe("a".repeat(64));
      expect(image.reference).toBe(REFERENCE);
      // The INDEX, not the child: the platform list and the per-architecture
      // digests are already in it, which is why no arch column exists.
      expect(JSON.parse(image.document).manifests).toHaveLength(3);
      // config 2_000 + two layers, one architecture's compressed total.
      expect(image.size).toBe(42_002_000);
    });

    it("exchanges a token first, then asks the tag with all four media types", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy();

      await client.read(REFERENCE);

      expect(registry.calls[0].url).toContain("/token");
      expect(registry.calls[0].url).toContain(
        "scope=repository%3Aalepha-dev%2Flore%3Apull",
      );
      const accept = registry.calls[1].headers.accept;
      for (const type of [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
      ]) {
        expect(accept).toContain(type);
      }
    });

    it("reads a single-arch manifest, which is its own child", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry
        .healthy({ index: childManifest() })
        // Its config digest is the one the child manifest names.
        .on("/blobs/", {
          status: 200,
          body: JSON.stringify({
            config: { Labels: { "dev.alepha.runtime": "bun" } },
          }),
        });

      const image = await client.read(REFERENCE);

      expect(image.runtime).toBe("bun");
      // Three calls, not four: there is no child to go and fetch.
      expect(registry.calls).toHaveLength(3);
    });

    it("reads a Docker manifest list, the other multi-arch shape", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy({
        index: dockerManifestList(`sha256:${"b".repeat(64)}`),
      });

      const image = await client.read(REFERENCE);

      expect(image.runtime).toBe("node");
    });

    it("prefers linux/amd64 and skips buildx's attestation entry", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy();

      await client.read(REFERENCE);

      // The index lists arm64 first and an `architecture: unknown`
      // attestation last. Neither is what a config blob was read from.
      const child = registry.calls[2].url;
      expect(child).toContain("b".repeat(64));
      expect(child).not.toContain("c".repeat(64));
      expect(child).not.toContain("d".repeat(64));
    });
  });

  describe("the size, which is best effort and never a fifth call", () => {
    it("is absent when a layer does not state one, and does not fetch more", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy({
        manifest: JSON.stringify({
          config: { digest: `sha256:${"e".repeat(64)}`, size: 2_000 },
          layers: [{ size: 30_000_000 }, {}],
        }),
      });

      const image = await client.read(REFERENCE);

      expect(image.size).toBeUndefined();
      // ⚠️ The whole rule: four calls, and a missing number costs no fifth.
      expect(registry.calls).toHaveLength(4);
      expect(image.runtime).toBe("node");
    });

    it("never makes a fifth call even for a healthy image", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy();

      await client.read(REFERENCE);

      expect(registry.calls).toHaveLength(4);
    });
  });

  describe("the config blob's redirect", () => {
    it("follows the hop WITHOUT carrying the bearer to the second host", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy().on("/blobs/", {
        status: 307,
        headers: {
          location:
            "https://pkg-containers.githubusercontent.com/blob?sig=presigned",
        },
      });
      registry.on("pkg-containers.githubusercontent.com", {
        status: 200,
        body: JSON.stringify({
          config: { Labels: { "dev.alepha.runtime": "node" } },
        }),
      });

      const image = await client.read(REFERENCE);

      expect(image.runtime).toBe("node");
      const hop = registry.calls.at(-1);
      expect(hop?.url).toContain("pkg-containers.githubusercontent.com");
      // ⚠️ ghcr's blob redirect already carries its own authorization in the
      // query string. Re-sending the bearer hands a registry token to a host
      // that never asked for one.
      expect(hop?.headers.authorization).toBeUndefined();
      // And the registry call before it DID carry it.
      expect(registry.calls.at(-2)?.headers.authorization).toBe(
        "Bearer anonymous-token",
      );
    });

    it("refuses a redirect that is not https", async ({ expect }) => {
      const { client, registry } = setup();
      registry.healthy().on("/blobs/", {
        status: 307,
        headers: { location: "http://pkg-containers.example.test/blob" },
      });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /follows https only/,
      );
    });
  });

  describe("refusing by name, never guessing", () => {
    it("names a failed token exchange, and says why a private repo fails", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy().on("/token", { status: 403, body: "" });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /token exchange with ghcr\.io failed \(HTTP 403\).*holds no registry credentials/s,
      );
    });

    it("names a tag that does not exist", async ({ expect }) => {
      const { client, registry } = setup();
      registry.healthy().on("/manifests/0.30.0", { status: 404, body: "" });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /alepha-dev\/lore:0\.30\.0 does not exist in the registry/,
      );
    });

    it("names the missing runtime label, and which architecture was read", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy({ labels: null });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /declares no `dev\.alepha\.runtime` label on linux\/amd64/,
      );
    });

    it("refuses a digest that is not sha256, rather than truncating it", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy({ digest: `sha512:${"a".repeat(128)}` });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /digested with `sha512`, and Lore records sha256 only/,
      );
    });

    it("refuses a digest that is not 64 hex characters", async ({ expect }) => {
      const { client, registry } = setup();
      registry.healthy({ digest: "sha256:not-a-digest" });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /not 64 hex characters of sha256/,
      );
    });

    it("refuses a supplied digest that disagrees with the registry's", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy();

      await expect(
        client.read(REFERENCE, { digest: `sha256:${"f".repeat(64)}` }),
      ).rejects.toThrowError(
        "ghcr.io/alepha-dev/lore:0.30.0 is aaaaaaaaaaaa in the registry, and the push claims ffffffffffff. The tag has moved, or the push names a different build.",
      );
      // ⚠️ Refused as soon as the digest is known: the child manifest and the
      // config blob are never fetched.
      expect(registry.calls).toHaveLength(2);
    });

    it("accepts a supplied digest in either spelling", async ({ expect }) => {
      const { client, registry } = setup();
      registry.healthy();

      // `sha256:` prefixed and bare are the same claim, not a mismatch.
      await expect(
        client.read(REFERENCE, { digest: `sha256:${"a".repeat(64)}` }),
      ).resolves.toMatchObject({ runtime: "node" });
      await expect(
        client.read(REFERENCE, { digest: "A".repeat(64) }),
      ).resolves.toMatchObject({ runtime: "node" });
    });

    it("names an unreachable registry rather than throwing a fetch error", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.fetch = async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      };

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /Could not reach the registry: getaddrinfo ENOTFOUND/,
      );
    });
  });

  describe("budgets, so a hostile registry is a fast refusal", () => {
    it("refuses an index naming more platforms than it will consider", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy({
        index: JSON.stringify({
          manifests: Array.from({ length: 200 }, (_, i) => ({
            digest: `sha256:${String(i).padStart(64, "0")}`,
            platform: { os: "linux", architecture: "amd64" },
          })),
        }),
      });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /index naming 200 manifests, past the 64/,
      );
      // ⚠️ The refusal is what keeps a hundred platforms from becoming a
      // hundred fetches: token and tag, and then it stops.
      expect(registry.calls).toHaveLength(2);
    });

    it("refuses a document larger than it will read, on the declared length", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy().on("/manifests/0.30.0", {
        status: 200,
        headers: {
          "docker-content-digest": `sha256:${"a".repeat(64)}`,
          "content-length": String(10 * 1024 * 1024),
        },
        body: "{}",
      });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /declares 10485760 bytes, past the 262144/,
      );
    });

    it("refuses a body that grows past the cap with no content-length", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy().on("/manifests/0.30.0", {
        status: 200,
        headers: { "docker-content-digest": `sha256:${"a".repeat(64)}` },
        // ⚠️ No `content-length`, so the cap has to hold on the STREAM. A
        // registry that omits it would otherwise choose how much memory a
        // push costs.
        body: "x".repeat(300 * 1024),
      });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /past the 262144 bytes Lore will read/,
      );
    });

    it("refuses a redirect loop rather than following it", async ({
      expect,
    }) => {
      const { client, registry } = setup();
      registry.healthy().on("/blobs/", {
        status: 307,
        headers: { location: "https://ghcr.io/v2/alepha-dev/lore/blobs/again" },
      });

      await expect(client.read(REFERENCE)).rejects.toThrowError(
        /redirected the config blob .* more than 3 times|more than 8 registry calls/,
      );
    });
  });
});
