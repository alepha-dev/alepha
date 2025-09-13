import { glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path, { basename, join } from "node:path";
import { $command } from "@alepha/command";
import { run } from "@alepha/core";
import { $logger } from "@alepha/logger";
import hljs from "highlight.js";
import { Marked, type Tokens } from "marked";
import { markedHighlight } from "marked-highlight";
import { theme } from "../src/config/theme.ts";
import { generateReadmes } from "./codegen-readme.ts";
import { snippets } from "./snippets.ts";

export type Docs = Record<
	string,
	Array<{
		slug: string;
		name: string;
		description: string;
		content: string;
		originalContent: string;
		originalName: string;
		path: string;
	}>
>;

class App {
	marked = this.createMarked();

	createMarked() {
		const marked = new Marked(
			markedHighlight({
				emptyLangClass: "hljs",
				langPrefix: "hljs language-",
				highlight(code, lang) {
					const language = hljs.getLanguage(lang) ? lang : "plaintext";
					return hljs.highlight(code, { language }).value;
				},
			}),
		);

		const renderer = {
			heading: ({ text, depth }: Tokens.Heading) => {
				const slug = text
					.replace(/\//g, "-")
					.replace(/[()`:/@]/g, "")
					.trim()
					.replace(/ /g, "-")
					.toLowerCase();

				// trick I learned by inspecting the mantine.dev website
				// instead of go-to <h1>, you go-to a <div> with metadata with a position top negative
				// it's the only way to manage all use-cases of fixed <header>
				return `
					<div id="${slug}" data-depth="${depth}" data-heading="${text}" style="position: relative; top: -${theme.headerHeight.base}px"></div>
					<h${depth}>${text}</h${depth}>
				`.trim();
			},
		};

		marked.use({ renderer });
		marked.use({
			gfm: true,
		});

		return marked;
	}

	log = $logger();

	root = $command({
		name: "",
		handler: async ({ run }) => {
			await run("generate readmes", async () => {
				await generateReadmes(process.cwd(), (msg: string) =>
					this.log.trace(msg),
				);
			});

			const rootDir = join(import.meta.dirname, "../../..");
			const outputDir = join(import.meta.dirname, "../node_modules/.docs");
			const docs: Docs = {};
			const categories = ["guide", "concepts"];

			await rm(outputDir, { force: true, recursive: true });
			await mkdir(outputDir, { recursive: true });

			docs.guide = [];
			docs.concepts = [];
			docs.packages = [];

			for (const category of categories) {
				await run(`parse /${category}`, async () => {
					const files = glob(`apps/docs/assets/${category}/**/*.md`, {
						cwd: rootDir,
					});

					docs[category] = docs[category].sort((a, b) =>
						a.name.localeCompare(b.name),
					);

					for await (const file of files) {
						const filepath = join(rootDir, file);
						const originalContent = await readFile(filepath, "utf-8");
						const content = await this.renderContent(originalContent);
						const name = basename(file.replace(".md", ""));
						docs[category].push({
							slug: `${this.slug(name)}`,
							name: this.pretty(name),
							content,
							originalContent,
							originalName: basename(file),
							description: "",
							path: file,
						});
					}
				});
			}

			await run("parse /packages", async () => {
				const files = glob(`packages/**/*.md`, {
					cwd: rootDir,
				});

				for await (const file of files) {
					if (file.includes("node_modules")) {
						continue;
					}

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

					const originalContent = await readFile(filepath, "utf-8");
					const content = await this.renderContent(originalContent);

					docs.packages.push({
						slug: this.slug(name),
						name: this.pretty(name),
						description,
						content,
						originalContent,
						originalName: `${this.slug(name)}.md`,
						path: file,
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
							// biome-ignore lint/suspicious/noUselessEscapeInString: ...
							.replaceAll(`\$\{`, "\\${")
							.replaceAll("\t", "  ");

						const filename = `${it.slug}.ts`;
						await writeFile(
							path.join(outputDir, filename),
							`export default \`${content}\``,
						);
						await writeFile(
							path.join(outputDir, `${key}-${it.originalName}`),
							it.originalContent,
						);

						result.push({
							...it,
							content: `${TAG}() => import('./${filename}').then(it => it.default)${TAG}`,
							category: key,
						});
					}
				}

				for (const key of Object.keys(snippets) as Array<
					keyof typeof snippets
				>) {
					snippets[key] = await this.renderContent(
						`\`\`\`tsx\n${snippets[key].trim()}\n\`\`\``,
					);
				}

				const outputFilepath = join(outputDir, "index.ts");
				const outputFileContent = `
					export const docs = ${JSON.stringify(result, null, 2)};
					export const snippets = ${JSON.stringify(snippets, null, 2)};
					`.trim();

				await writeFile(
					outputFilepath,
					outputFileContent.replace(new RegExp(`"?${TAG}"?`, "g"), ""),
				);
			});
		},
	});

	slug(name: string) {
		return name
			.replace(/(\d+)-/, "") // remove leading numbers
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

	renderContent(content: string) {
		return this.marked.parse(content);
	}
}

run(App, {
	env: {
		LOG_FORMAT: "raw",
		LOG_LEVEL: "alepha.command:info,warn",
	},
});
