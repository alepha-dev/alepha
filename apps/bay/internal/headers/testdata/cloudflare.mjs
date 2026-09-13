// Checks cases.json against Cloudflare's own code: wrangler parses _headers
// and miniflare's asset worker applies it, exactly as a deploy would. Boots
// workerd, so it is not part of `yarn test`. Run it from the repo root whenever
// _headers or cases.json changes:
//
//   node apps/bay/internal/headers/testdata/cloudflare.mjs
//
// Every header the fixture's _headers names, plus every header a case lists,
// must be what Cloudflare answers: the value expected, or absent.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.cwd();
const wrangler = join(repo, "node_modules/.bin/wrangler");
const { cases } = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const headersText = readFileSync(join(here, "_headers"), "utf8");

// Every header name the rules mention, set or removed.
const named = new Set();
for (const raw of headersText.split("\n")) {
  const line = raw.trim();
  if (line === "" || line.startsWith("#") || line.startsWith("/")) continue;
  const name = line.startsWith("! ")
    ? line.slice(2)
    : line.slice(0, line.indexOf(":"));
  named.add(name.trim().toLowerCase());
}

// One file per 200 case, so the asset worker has something to serve; every
// other case is a miss answered with 404.html.
const files = {
  "index.html": "<!doctype html><title>index</title>",
  "404.html": "<!doctype html><title>not found</title>",
  "chunk.AbCd1234.js": "export {};",
  "asset.AbCd1234.png": "png",
  "logo.png": "png",
  "docs/café": "encoded",
  "app/main.js": "export {};",
  "bay/install.sh": "#!/bin/sh",
  "raw/data.txt": "data",
};

const freePort = () =>
  new Promise((ok) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });

const work = await mkdtemp(join(tmpdir(), "headers-fixture-"));
const pub = join(work, "public");
for (const [name, body] of Object.entries(files)) {
  await mkdir(dirname(join(pub, name)), { recursive: true });
  await writeFile(join(pub, name), body);
}
await copyFile(join(here, "_headers"), join(pub, "_headers"));
await writeFile(
  join(work, "wrangler.json"),
  JSON.stringify({
    name: "headers-fixture",
    compatibility_date: "2025-11-17",
    assets: { directory: "./public", not_found_handling: "404-page" },
  }),
);

const port = await freePort();
const dev = spawn(
  wrangler,
  ["dev", "--port", String(port), "--ip", "127.0.0.1", "--log-level", "warn"],
  { cwd: work, stdio: ["ignore", "inherit", "inherit"], env: process.env },
);

const base = `http://127.0.0.1:${port}`;
let failures = 0;
try {
  for (let i = 0; ; i++) {
    try {
      await fetch(`${base}/`);
      break;
    } catch {
      if (i > 120) throw new Error("wrangler dev never answered");
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }

  for (const c of cases) {
    let response = await fetch(`${base}${c.path}`, { redirect: "manual" });
    if (c.status === 304) {
      const etag = response.headers.get("etag");
      await response.arrayBuffer();
      response = await fetch(`${base}${c.path}`, {
        redirect: "manual",
        headers: { "if-none-match": etag ?? "" },
      });
    }
    await response.arrayBuffer();

    const wrong = [];
    if (response.status !== c.status) {
      wrong.push(`status ${response.status}, expected ${c.status}`);
    }
    const names = new Set([
      ...named,
      ...Object.keys(c.defaults),
      ...Object.keys(c.expected),
    ]);
    for (const name of names) {
      const actual = response.headers.get(name) ?? undefined;
      const expected = c.expected[name];
      if (actual !== expected) {
        wrong.push(
          `${name}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        );
      }
    }
    if (wrong.length > 0) {
      failures++;
      console.log(`FAIL ${c.name} (${c.path})\n  ${wrong.join("\n  ")}`);
    } else {
      console.log(`ok   ${c.name}`);
    }
  }
} finally {
  dev.kill();
  await rm(work, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? `\nall ${cases.length} cases agree with Cloudflare`
    : `\n${failures} case(s) disagree with Cloudflare`,
);
process.exit(failures === 0 ? 0 : 1);
