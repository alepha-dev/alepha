import fs, { readFile } from "node:fs/promises";
import path from "node:path";
import hljs from "highlight.js";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

const marked = new Marked(
	markedHighlight({
		emptyLangClass: "hljs",
		langPrefix: "hljs language-",
		highlight(code, lang, info) {
			const language = hljs.getLanguage(lang) ? lang : "plaintext";
			return hljs.highlight(code, { language }).value;
		},
	}),
);

const packagesDir = path.resolve(process.cwd(), "../../packages");
const outputDir = path.resolve(process.cwd(), "../../apps", "docs");
const outputFile = path.join(outputDir, "node_modules/data.ts");

async function getFiles(dir, prefixToRemove) {
	try {
		const dirents = await fs.readdir(dir, { withFileTypes: true });
		return dirents
			.filter((dirent) => dirent.isFile() && dirent.name.endsWith(".ts"))
			.map((dirent) => ({
				name: dirent.name.replace(".ts", ""),
				slug: dirent.name.replace(".ts", "").toLowerCase(),
				path: path
					.join(dir, dirent.name)
					.replace(prefixToRemove, "")
					.replace(/\\/g, "/"),
			}));
	} catch (error) {
		if (error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

async function generateModuleData() {
	console.log("Generating documentation data...");
	const packageDirs = await fs.readdir(packagesDir, { withFileTypes: true });
	const modules = [];

	await fs.mkdir(`${outputDir}/node_modules`, { recursive: true });

	for (const dirent of packageDirs) {
		if (!dirent.isDirectory()) continue;
		const modulePath = path.join(packagesDir, dirent.name);

		try {
			const pkgJsonPath = path.join(modulePath, "package.json");
			const pkgJsonContent = await fs.readFile(pkgJsonPath, "utf8");
			const pkgJson = JSON.parse(pkgJsonContent);

			if (pkgJson.private || pkgJson.name === "alepha") continue;

			const descriptors = await getFiles(
				path.join(modulePath, "src", "descriptors"),
				modulePath,
			);
			const providers = await getFiles(
				path.join(modulePath, "src", "providers"),
				modulePath,
			);

			modules.push({
				name: pkgJson.name,
				slug: dirent.name,
				description: pkgJson.description,
				readme: await marked.parse(
					await readFile(path.join(modulePath, "README.md"), "utf-8"),
				),
				descriptors,
				providers,
			});
		} catch (error) {
			console.warn(`Skipping ${dirent.name}: ${error.message}`);
		}
	}

	// Sort modules alphabetically
	modules.sort((a, b) => a.name.localeCompare(b.name));

	await fs.mkdir(outputDir, { recursive: true });
	await fs.writeFile(
		outputFile,
		`export const data = ${JSON.stringify(modules, null, 2)}`,
	);
	console.log(
		`Successfully generated data for ${modules.length} modules to ${outputFile}`,
	);
}

generateModuleData().catch(console.error);
