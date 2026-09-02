#!/usr/bin/env node
/**
 * Measures the self-hosted Lore image and holds it to a budget.
 *
 * ## What "200 MB" means here
 *
 * It is the COMPRESSED size: the number of bytes `docker pull` actually
 * downloads, summed over the layer blobs in the OCI manifest. That is the
 * only figure a self-hoster experiences, and it is the only one this script
 * gates on.
 *
 * The alternative reading, the unpacked size on disk, would already be blown
 * by the base image alone, so a budget expressed that way is not a ceiling,
 * it is a number that has to be doubled before it can be met at all.
 *
 * ⚠️ **Do not measure this with `docker image inspect .Size` or the `docker
 * images` SIZE column.** What those report depends on which image store the
 * daemon runs: under the classic graph driver `.Size` is the UNCOMPRESSED
 * total, under the containerd store it is closer to the compressed one, and
 * the `docker images` column disagrees with both when a build produced
 * several platform variants. Measured on one machine on 2026-09-02, the same
 * image read as 314 MB (`docker images`), 75.6 MB (`inspect .Size`) and
 * 77.6 MB (this script). Only the last one is what a pull costs.
 *
 * Building both platforms is not only a measurement: it is the only place
 * outside a dispatched Release where the multi-arch build the release
 * performs is exercised at all.
 *
 * Usage:  node scripts/docker-size.mjs [--budget-mb 200] [--context apps/lore/dist]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLATFORMS = ["linux/amd64", "linux/arm64"];
const MB = 1_000_000;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const budgetMb = Number(flag("budget-mb", "200"));
const context = flag("context", "apps/lore/dist");

const run = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", ...opts });

/** One file out of a tar, without unpacking the archive. */
const readEntry = (tarball, name) =>
  run("tar", ["-xOf", tarball, name], { maxBuffer: 64 * MB });

const readJson = (tarball, name) => JSON.parse(readEntry(tarball, name));

const readBlob = (tarball, digest) => {
  const [algo, hex] = digest.split(":");
  return readJson(tarball, `blobs/${algo}/${hex}`);
};

/**
 * The image manifest, following the index buildx wraps single-platform
 * output in. Attestation manifests carry no `platform.architecture` and are
 * skipped: they are metadata, not something a runtime pulls.
 */
const findManifest = (tarball) => {
  let entry = readJson(tarball, "index.json").manifests[0];
  let doc = readBlob(tarball, entry.digest);
  while (Array.isArray(doc.manifests)) {
    entry = doc.manifests.find(
      (it) =>
        it.platform?.architecture && it.platform.architecture !== "unknown",
    );
    if (!entry) {
      throw new Error(`no image manifest in ${tarball}`);
    }
    doc = readBlob(tarball, entry.digest);
  }
  return doc;
};

const workDir = mkdtempSync(join(tmpdir(), "lore-size-"));
let failed = false;

try {
  for (const platform of PLATFORMS) {
    const arch = platform.split("/")[1];
    const tarball = join(workDir, `${arch}.tar`);

    process.stdout.write(`── building ${platform}\n`);
    run(
      "docker",
      [
        "buildx",
        "build",
        "--platform",
        platform,
        "--output",
        `type=oci,dest=${tarball},compression=gzip`,
        ".",
      ],
      { cwd: context, stdio: ["ignore", "inherit", "inherit"] },
    );

    const manifest = findManifest(tarball);
    const layers = manifest.layers;
    const compressed = layers.reduce((sum, it) => sum + it.size, 0);

    console.log(`\n── ${platform}`);
    layers.forEach((layer, i) => {
      // Layer 0 and 1 are the base image; the app arrives in one COPY.
      console.log(
        `   layer ${i}: ${(layer.size / MB).toFixed(1).padStart(7)} MB`,
      );
    });
    const verdict = compressed / MB <= budgetMb ? "OK" : "OVER BUDGET";
    console.log(
      `   compressed (what a pull downloads): ${(compressed / MB).toFixed(1)} MB` +
        ` / ${budgetMb} MB  → ${verdict}`,
    );

    if (compressed / MB > budgetMb) {
      failed = true;
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failed) {
  console.error(
    `\nThe image is over its ${budgetMb} MB budget.\n` +
      "Cheapest levers first: confirm `dist/package.json` has no dependencies (an\n" +
      "`npm install` line in the Dockerfile means Vite did not bundle something),\n" +
      "then drop source maps and the `--stats` report from the shipped build.",
  );
  process.exit(1);
}

console.log("\nimage size within budget");
