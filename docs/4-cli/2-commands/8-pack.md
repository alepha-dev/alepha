# Pack Command

Pack a built workspace into a deployable `tar.zst`. The archive contains everything a remote runner needs to deploy the app - Alepha Bay, Alepha Rocket, or any `alepha platform ... --prebuilt` consumer - and nothing else.

## Quick Start

```bash
alepha build --runtime node,workerd
alepha pack --tag 0.0.2
# → my-app-0.0.2.tar.zst
```

## What's Inside

The build's contents are at the **archive root**. There is no `dist/` wrapper:

```txt
public/               client bundle and prerendered HTML
server/node/          one chunk directory per server slice
server/workerd/
index.node.js         one entry wrapper per slice
index.workerd.js
manifest.json         what the build declared
migrations/           SQL migration files (if present)
```

No source, no `alepha.config.ts`, no `package.json` - the deploy side reads everything it needs from `manifest.json` (which slices are inside, detected resources, declared env keys, platform options) and never touches source. Excluded: `node_modules`, `.alepha` build cache, `e2e`, `playwright-report`, `coverage`, and OS junk files.

## Why zstd, and why the window is pinned

A multi-slice artifact holds near-identical copies of the same bundle, megabytes apart. DEFLATE's match window is 32 KB, so gzip never sees the second copy and the archive is simply twice the size. zstd with long-range matching does see it, but only if its window spans the distance between the two.

Measured on a real two-slice build of Lore, 61 MB uncompressed:

|                              | one slice | two slices | ratio     |
| ---------------------------- | --------- | ---------- | --------- |
| `gzip -9`                    | 1.72 MB   | 3.44 MB    | **2.00x** |
| zstd, default window         | 1.45 MB   | 2.88 MB    | **1.99x** |
| zstd, pinned window (32 MiB) | 1.45 MB   | 1.47 MB    | **1.02x** |

At the default window nothing fails: the archive is just twice the size it should be, at gzip-like ratios with extra machinery. The window is pinned explicitly and the ratio is asserted in a spec, because a pinned value alone drifts as apps outgrow it and an assertion alone never sets it.

Source maps are excluded from the artifact and written to a sibling `<project>-<tag>.maps.tar.zst`, rooted the same way so a map sits beside the chunk it describes.

## Options

| Flag             | Description                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `--tag`, `-t`    | Tag suffix for the artifact name, Docker-style (default: `latest` → `<project>-latest.tar.zst`) |
| `--output`, `-o` | Output directory for the archive (default: current directory)                                   |
| `--name`, `-n`   | Project name for the artifact filename (default: `package.json` `name`)                         |

The project name comes from `package.json` `name`, slugified for the filename (`@acme/app` → `acme-app`).

`--name` is what a deploy passes when the app is known by another name: `platform({ name })` sets the identity the deploy side uses, and it is free to differ from the package name. `alepha platform up` passes it for you, so `pack` writes the file the deploy then looks for. Unlike the `package.json` default it is used verbatim, so it has to be a plain filename: letters, digits, `.`, `_` and `-`.

## Deploying a Packed Artifact

On the consumer side, extract the archive and run the platform commands in prebuilt mode:

```bash
tar -xf my-app-0.0.2.tar.zst
alepha p up --prebuilt
```

`--prebuilt` skips the Vite bundle steps - only the deploy config (`wrangler.jsonc`) is regenerated from the manifest, so a bare artifact deploys without the app's source tree or its `node_modules`.

This is the workflow external orchestrators (like Alepha Rocket) use: build once, pack once, deploy the same artifact to many environments or tenants.
