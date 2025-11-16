#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function getAllFiles(dir, fileList = []) {
  const files = await readdir(dir, { withFileTypes: true });

  for (const file of files) {
    const filePath = join(dir, file.name);

    if (file.isDirectory()) {
      await getAllFiles(filePath, fileList);
    } else if (file.name.endsWith(".ts") || file.name.endsWith(".tsx")) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

async function fixImports() {
  const testDir = __dirname;
  const files = await getAllFiles(testDir);

  let totalReplacements = 0;

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const fileDir = dirname(filePath);
    const moduleName = relative(testDir, fileDir).split("/")[0];

    // Skip if file is directly in test directory (no module subdirectory)
    if (!moduleName || moduleName === ".") {
      continue;
    }

    // Replace "../src/" with "../../src/<moduleName>/" and "../src" with "../../src/<moduleName>"
    const pattern = /(['"])\.\.\/src(\/|\1)/g;
    const replacement = `$1../../src/${moduleName}$2`;
    const newContent = content.replace(pattern, replacement);

    if (newContent !== content) {
      await writeFile(filePath, newContent, "utf-8");
      const count = (content.match(pattern) || []).length;
      totalReplacements += count;
      console.log(
        `✓ Fixed ${count} import(s) in ${relative(testDir, filePath)}`,
      );
    }
  }

  console.log(
    `\n✅ Total: ${totalReplacements} imports fixed across ${files.length} files`,
  );
}

fixImports().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
