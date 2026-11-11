/**
 * Asserts the Lore image a registry holds carries its evidence (#Q3363): an
 * image index with a linux/amd64 image, an SBOM attestation (SPDX) and a
 * provenance attestation (SLSA), as `alepha image --sbom --provenance --push`
 * attaches them.
 *
 * Run by Verify Lore's `docker` job and by Release, both against the registry
 * container on the runner that `yarn w lore image:release` pushed to. Neither
 * ghcr nor a token is involved: the registry is plain HTTP on the loopback.
 *
 * `--save <file>` writes the index document as the registry served it, which
 * is how the case in `image-registry-client.spec.ts` was captured: Lore reads
 * ghcr only, so it cannot be pointed at this registry to prove it handles the
 * index, and a captured document is the next best thing to discovering a
 * difference on release day.
 *
 * Usage:  node scripts/docker-attestations.ts --image 127.0.0.1:5000/alepha-dev/lore:ci [--save index.json]
 */
import { writeFileSync } from "node:fs";

interface Descriptor {
  mediaType: string;
  digest: string;
  platform?: { os: string; architecture: string };
  annotations?: Record<string, string>;
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const image = flag("image");
const save = flag("save");
if (!image) {
  console.error(
    "usage: node scripts/docker-attestations.ts --image <host:port/repo:tag> [--save index.json]",
  );
  process.exit(2);
}

const slash = image.indexOf("/");
const colon = image.lastIndexOf(":");
const host = image.slice(0, slash);
const repository = image.slice(slash + 1, colon);
const tag = image.slice(colon + 1);

const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

const manifest = async (
  reference: string,
): Promise<{ body: string; digest: string }> => {
  const response = await fetch(
    `http://${host}/v2/${repository}/manifests/${reference}`,
    { headers: { accept: ACCEPT } },
  );
  const body = await response.text();
  if (response.status !== 200) {
    console.error(
      `✗ ${image}: ${reference} answered ${response.status} ${body}`,
    );
    process.exit(1);
  }
  return { body, digest: response.headers.get("docker-content-digest") ?? "" };
};

const fail = (message: string): never => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const index = await manifest(tag);
const document = JSON.parse(index.body) as { manifests?: Descriptor[] };
if (!document.manifests) {
  fail(
    `${image} is a single manifest, not an index: no attestation can be attached to it`,
  );
}
const manifests = document.manifests ?? [];

const images = manifests.filter(
  (it) =>
    it.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest",
);
const platforms = images.map(
  (it) => `${it.platform?.os}/${it.platform?.architecture}`,
);
if (!platforms.includes("linux/amd64")) {
  fail(`${image} has no linux/amd64 image (found ${platforms.join(", ")})`);
}
console.log(`✓ ${image} → ${index.digest}, platforms ${platforms.join(", ")}`);

const predicates: string[] = [];
for (const attestation of manifests.filter(
  (it) =>
    it.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
)) {
  const body = JSON.parse((await manifest(attestation.digest)).body) as {
    layers?: Array<{ annotations?: Record<string, string> }>;
  };
  for (const layer of body.layers ?? []) {
    const type = layer.annotations?.["in-toto.io/predicate-type"];
    if (type) predicates.push(type);
  }
}

if (!predicates.includes("https://spdx.dev/Document")) {
  fail(
    `${image} carries no SBOM attestation (predicates: ${predicates.join(", ") || "none"})`,
  );
}
console.log("✓ SBOM attestation (https://spdx.dev/Document)");
const provenance = predicates.find((it) =>
  it.startsWith("https://slsa.dev/provenance/"),
);
if (!provenance) {
  fail(
    `${image} carries no provenance attestation (predicates: ${predicates.join(", ")})`,
  );
}
console.log(`✓ provenance attestation (${provenance})`);

if (save) {
  writeFileSync(save, `${index.body}\n`);
  console.log(`  index written to ${save}`);
}
