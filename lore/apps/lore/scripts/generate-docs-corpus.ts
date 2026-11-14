#!/usr/bin/env node --experimental-strip-types
/**
 * Regenerates the assistant's docs corpus (#Q3212) from the guides under `lore/docs`:
 *
 *   yarn w lore docs:corpus
 *
 * Run it after editing a guide; `assistant-docs.spec.ts` fails until the
 * committed corpus matches the guides.
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LoreDocsCorpusBuilder } from "../src/assistant/docs/LoreDocsCorpusBuilder.ts";

const here = dirname(fileURLToPath(import.meta.url));
const guides = join(here, "../../../docs");
const target = join(here, "../src/assistant/docs/docsCorpus.ts");

// Every guide, named by its path under `lore/docs`: `3-plan/1-quests.md`.
const names = (await readdir(guides, { recursive: true }))
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.split("\\").join("/"));
const files = await Promise.all(
  names.map(async (name) => ({
    name,
    content: await readFile(join(guides, name), "utf8"),
  })),
);
const builder = new LoreDocsCorpusBuilder();
const sections = builder.build(files);
await writeFile(target, builder.render(sections));
// Formatted as `yarn lint` would, so a regeneration with no guide change is
// no diff.
execFileSync(
  "node",
  [join(here, "../../../../node_modules/oxfmt/bin/oxfmt"), target],
  {
    stdio: "ignore",
  },
);
console.log(
  `docs corpus: ${sections.length} sections from ${names.length} guides`,
);
