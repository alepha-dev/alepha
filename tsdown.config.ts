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
				entry: "src/index.ts",
				format: ["esm"],
				sourcemap: true,
        fixedExtension: false,
      },
			{
				entry: "src/index.browser.ts",
				platform: "browser",
				sourcemap: true,
				dts: false,
			},
		];
	}
	return [
		{
			entry: "src/index.ts",
			format: ["esm"],
			platform: "neutral", // TODO: index.node.ts for node specific build
			sourcemap: true,
      fixedExtension: false,
		},
	];
}
