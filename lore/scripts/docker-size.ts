#!/usr/bin/env node
/**
 * Measures the self-hosted Lore image and holds it to a budget.
 *
 * ## What "200 MB" means here
 *
 * It is the COMPRESSED size: the number of bytes `docker pull` actually
 * downloads, summed over the image's layers once gzipped, which is how a
 * push stores them. That is the only figure a self-hoster experiences, and it
 * is the only one this script gates on.
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
 * ## It measures, it does not build
 *
 * The image is the one `alepha image` built (`yarn w lore build:docker`), the
 * same command Release runs. This script used to run a `buildx` build of its
 * own for amd64 and arm64, and that second build path is how a moved
 * Dockerfile reached release day unnoticed (#Q2492). The image is amd64 only
 * since #Q2493, so there is nothing left for a build here to add.
 *
 * `docker save` hands the layers over as the store keeps them: uncompressed
 * tars under the classic store, possibly gzip under containerd. A layer that
 * is already gzip counts as is, any other is gzipped here at the default
 * level, which is what a push does. The figure is within a few percent of the
 * registry's, and it no longer depends on the daemon's store.
 *
 * Usage:  node scripts/docker-size.ts [--budget-mb 200] [--image ghcr.io/alepha-dev/lore:latest]
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGzip } from "node:zlib";

/**
 * The `manifest.json` every `docker save` archive carries, whichever store
 * wrote it. Only the layer paths are read.
 */
interface SaveManifest {
  Layers: string[];
}

const MB = 1_000_000;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const budgetMb = Number(flag("budget-mb", "200"));
const image = flag("image", "ghcr.io/alepha-dev/lore:latest");

/**
 * The bytes one layer costs a pull: its size if the archive already holds it
 * gzipped, else the size of its gzip, streamed so a large layer never sits in
 * memory.
 */
const compressedSize = (tarball: string, entry: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-xOf", tarball, entry]);
    const gzip = createGzip();
    let raw = 0;
    let packed = 0;
    let gzipped: boolean | undefined;

    tar.stdout.on("data", (chunk: Buffer) => {
      if (gzipped === undefined) {
        gzipped = chunk[0] === 0x1f && chunk[1] === 0x8b;
      }
      raw += chunk.length;
      if (!gzipped) {
        gzip.write(chunk);
      }
    });
    tar.stdout.on("end", () => gzip.end());
    gzip.on("data", (chunk: Buffer) => {
      packed += chunk.length;
    });
    gzip.on("end", () => resolve(gzipped ? raw : packed));
    gzip.on("error", reject);
    tar.on("error", reject);
    tar.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tar exited ${code} reading ${entry}`));
      }
    });
  });

const workDir = mkdtempSync(join(tmpdir(), "lore-size-"));
let failed = false;

try {
  const tarball = join(workDir, "image.tar");
  process.stdout.write(`── saving ${image}\n`);
  execFileSync("docker", ["save", "--output", tarball, image], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  const [manifest] = JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "manifest.json"], {
      encoding: "utf8",
    }),
  ) as SaveManifest[];
  if (!manifest?.Layers?.length) {
    throw new Error(`no layers in the saved ${image}`);
  }

  const sizes: number[] = [];
  for (const layer of manifest.Layers) {
    sizes.push(await compressedSize(tarball, layer));
  }
  const compressed = sizes.reduce((sum, it) => sum + it, 0);

  console.log(`\n── ${image}`);
  sizes.forEach((size, i) => {
    // The first layers are the base image; the app arrives in one COPY.
    console.log(`   layer ${i}: ${(size / MB).toFixed(1).padStart(7)} MB`);
  });
  const verdict = compressed / MB <= budgetMb ? "OK" : "OVER BUDGET";
  console.log(
    `   compressed (what a pull downloads): ${(compressed / MB).toFixed(1)} MB` +
      ` / ${budgetMb} MB  → ${verdict}`,
  );

  if (compressed / MB > budgetMb) {
    failed = true;
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
