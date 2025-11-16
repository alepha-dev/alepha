import { readFile } from "node:fs/promises";

export default async () => {
  let hasBrowser = false;
  try {
    await readFile("index.browser.ts");
    hasBrowser = true;
  } catch {}

  // check if "index.browser.ts" exists in dir
	if (hasBrowser) {
		return [
			{
				entry: "index.ts",
				format: ["esm", "cjs"],
				sourcemap: true,
        fixedExtension: false,
      },
			{
				entry: "index.browser.ts",
				platform: "browser",
				sourcemap: true,
				dts: false,
			},
		];
	}
	return [
		{
			entry: "index.ts",
			format: ["esm", "cjs"],
			platform: "neutral", // TODO: index.node.ts for node specific build
			sourcemap: true,
      fixedExtension: false,
		},
	];
}
