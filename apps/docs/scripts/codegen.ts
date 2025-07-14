import { glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path, { basename, join } from "node:path";
import { $command } from "@alepha/command";
import { $logger, run } from "@alepha/core";
import hljs from "highlight.js";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

export type Docs = Record<
	string,
	Array<{
		slug: string;
		name: string;
		description: string;
		content: string;
	}>
>;

class App {
	marked = new Marked(
		markedHighlight({
			emptyLangClass: "hljs",
			langPrefix: "hljs language-",
			highlight(code, lang) {
				const language = hljs.getLanguage(lang) ? lang : "plaintext";
				return hljs.highlight(code, { language }).value;
			},
		}),
	);

	log = $logger();

	root = $command({
		name: "",
		handler: async ({ run }) => {
			const rootDir = join(import.meta.dirname, "../../..");
			const outputDir = join(import.meta.dirname, "../node_modules/.docs");
			const docs: Docs = {};
			const categories = ["guides", "concepts"];

			await rm(outputDir, { force: true, recursive: true });
			await mkdir(outputDir, { recursive: true });

			docs.guides = [];
			docs.concepts = [];
			docs.packages = [];

			for (const category of categories) {
				await run(`parse /${category}`, async () => {
					const files = glob(`docs/${category}/**/*.md`, {
						cwd: rootDir,
					});

					docs[category] = docs[category].sort((a, b) =>
						a.name.localeCompare(b.name),
					);

					for await (const file of files) {
						const name = basename(file.replace(".md", ""));
						docs[category].push({
							slug: `${this.slug(name)}`,
							name: this.pretty(name),
							content: await this.render(join(rootDir, file)),
							description: "",
						});
					}
				});
			}

			await run("parse /packages", async () => {
				const files = glob(`packages/**/*.md`, {
					cwd: rootDir,
				});

				for await (const file of files) {
					const filepath = join(rootDir, file);
					const pkgFile = await readFile(
						filepath.replace("README.md", "package.json"),
						"utf8",
					).catch(() => undefined);

					if (!pkgFile) {
						continue;
					}

					const { name, description } = JSON.parse(pkgFile);
					if (name === "alepha" || !description) {
						continue; // skip "alepha"
					}

					docs.packages.push({
						slug: this.slug(name),
						name: this.pretty(name),
						description,
						content: await this.render(filepath),
					});

					docs.packages = docs.packages.sort((a, b) =>
						a.name.localeCompare(b.name),
					);
				}
			});

			await run("write", async () => {
				const TAG = "%TBRM%";
				const result: Array<any> = [];

				for (const key of Object.keys(docs)) {
					const list = docs[key];
					for (const it of list) {
						const content = it.content
							.replaceAll("`", "\\`")
							.replaceAll(`\$\{`, "\\${")
							.replaceAll("\t", "  ");

						const filename = `${it.slug}.ts`;
						await writeFile(
							path.join(outputDir, filename),
							`export default \`${content}\``,
						);

						result.push({
							...it,
							content: `${TAG}() => import('./${filename}').then(it => it.default)${TAG}`,
							category: key,
						});
					}
				}

				const outputFilepath = join(outputDir, "index.ts");
				const outputFileContent = `export const docs = ${JSON.stringify(result, null, 2)}`;

				await writeFile(
					outputFilepath,
					outputFileContent.replace(new RegExp(`"?${TAG}"?`, "g"), ""),
				);
			});
		},
	});

	slug(name: string) {
		return name
			.replace(/(\d+)-/, "")
			.replace(/[/\\]/g, "-")
			.replace("@", "");
	}

	pretty(name: string) {
		return name
			.replace(/(\d+)-/, "")
			.replace(/[-/\\]/g, " ")
			.replace("@", "")
			.split(" ")
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
	}

	async render(filepath: string) {
		const content = await readFile(filepath, "utf8");
		return await this.marked.parse(content);
	}
}

run(App, {
	env: {
		LOG_FORMAT: "raw",
		LOG_LEVEL: "alepha.command:info,warn",
	},
});
