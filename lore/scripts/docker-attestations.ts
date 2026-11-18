/**
 * Asserts the Lore image a registry holds carries its evidence (#Q3363): an
 * image index with a linux/amd64 and a linux/arm64 image (#Q3858), and for
 * EACH of them an SBOM attestation (SPDX) and a provenance attestation
 * (SLSA), as `alepha image --sbom --provenance --push` attaches them. An
 * attestation manifest names the image it is about in its
 * `vnd.docker.reference.digest` annotation, so an index whose arm64 image
 * shipped bare would still carry amd64's predicates: they are counted per
 * image, never pooled.
 *
 * Run by Verify's `lore-docker` job and by Release, both against the registry
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
for (const required of ["linux/amd64", "linux/arm64"]) {
  if (!platforms.includes(required)) {
    fail(`${image} has no ${required} image (found ${platforms.join(", ")})`);
  }
}
console.log(`✓ ${image} → ${index.digest}, platforms ${platforms.join(", ")}`);

const predicatesByImage = new Map<string, string[]>();
for (const attestation of manifests.filter(
  (it) =>
    it.annotations?.["vnd.docker.reference.type"] === "attestation-manifest",
)) {
  const subject = attestation.annotations?.["vnd.docker.reference.digest"];
  if (!subject) continue;
  const body = JSON.parse((await manifest(attestation.digest)).body) as {
    layers?: Array<{ annotations?: Record<string, string> }>;
  };
  const predicates = predicatesByImage.get(subject) ?? [];
  for (const layer of body.layers ?? []) {
    const type = layer.annotations?.["in-toto.io/predicate-type"];
    if (type) predicates.push(type);
  }
  predicatesByImage.set(subject, predicates);
}

for (const it of images) {
  const platform = `${it.platform?.os}/${it.platform?.architecture}`;
  const predicates = predicatesByImage.get(it.digest) ?? [];
  if (!predicates.includes("https://spdx.dev/Document")) {
    fail(
      `${image} ${platform} carries no SBOM attestation (predicates: ${predicates.join(", ") || "none"})`,
    );
  }
  const provenance = predicates.find((p) =>
    p.startsWith("https://slsa.dev/provenance/"),
  );
  if (!provenance) {
    fail(
      `${image} ${platform} carries no provenance attestation (predicates: ${predicates.join(", ") || "none"})`,
    );
  }
  console.log(
    `✓ ${platform}: SBOM attestation (https://spdx.dev/Document), provenance attestation (${provenance})`,
  );
}

if (save) {
  writeFileSync(save, `${index.body}\n`);
  console.log(`  index written to ${save}`);
}
