# Compile Command

Compile a built `dist/` into one executable, with the client's `public/` files inside it.

## Quick Start

```bash
alepha build --runtime bun
alepha compile --out my-app
# → dist/my-app
```

The binary carries its own runtime: nothing has to be installed where it runs. It serves its assets from inside itself, ETag and precompressed brotli included.

## It compiles the bun slice, and only that one

`bun build --compile` is what exists, so the binary is a Bun binary and the bundle it embeds has to be the one resolved against Bun's export conditions. A `dist/` with no `index.bun.js` is refused by name:

```txt
`alepha compile` needs the bun slice, and `index.bun.js` is not in the build.
Rebuild with `alepha build --runtime bun` (or add `bun` to `build.runtime`).
```

⚠️ It never falls back to whichever slice is there. The **node slice runs under Bun**, which makes that fallback plausible and wrong: it would compile the generic build and quietly discard the reason the bun slice exists, producing a working binary with every Bun-native API and every dependency the bun conditions exist to drop still inside it. A binary that works is the worst available failure, because nothing ever says the slice was wrong.

When Node gains the same capability, the command switches which slice it picks and nothing else moves.

## It consumes `dist/`

`server/` and `public/` are removed once the binary carries them, and so is **every** slice's entry wrapper, read from the manifest. `manifest.json` and `migrations/` stay:

```txt
dist/
  my-app          the binary
  manifest.json
  migrations/     when the app has any
```

Leaving a sibling `index.node.js` behind would leave a file importing a `server/` that no longer exists: it looks runnable, is not, and fails with a resolution error naming nothing about the compile that removed its chunks.

## `./dist` only

It never unpacks an archive. If you have one, unpack it first.

## Options

| Flag             | Description                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| `--out`, `-o`    | File name of the binary inside `dist/` (default: `app`)                |
| `--target`, `-t` | Bun target triple, e.g. `bun-linux-arm64-musl` (default: this machine) |
| `--minify`       | Minify the compiled output (default: on)                               |

⚠️ There is no `compile:` config key. Three settings, all flags: a key nobody sets is worse than three flags, and `alepha image` drives the triple itself rather than reading one from config.

⚠️ **The triple picks the libc.** A Bun `--compile` binary is not static: it needs an interpreter, `libstdc++` and `libgcc`. Building for a container means naming the triple its base provides, which is what [`alepha image`](/docs/cli-commands-image) does for you.

## Running it

```bash
cd dist && APP_SECRET=... SERVER_HOST=127.0.0.1 ./my-app
```

- Run it from the directory holding `migrations/`: the app reads them relative to where it starts.
- Set `SERVER_HOST`: under Bun, `localhost` listens on IPv6 `::1` only.
- Expect about 60 MB, almost all of it the Bun runtime. Windows is untested.
