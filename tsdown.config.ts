import { readFile } from "node:fs/promises";

export default async () => {
	const pkg = JSON.parse(await readFile("./package.json", "utf-8"));
	if (pkg.browser) {
		return [
			{
				entry: "src/index.ts",
				format: ["esm", "cjs"],
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
			format: ["esm", "cjs"],
			platform: pkg.engines?.node ? "node" : "neutral",
			sourcemap: true,
      fixedExtension: false,
		},
	];
}
