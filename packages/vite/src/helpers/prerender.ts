import { mkdir, readFile, writeFile } from "node:fs/promises";
import { KIND, OPTIONS } from "@alepha/core";
import { importAlepha } from "./importAlepha.ts";

export interface PrerenderOptions {
	entry: string;
	dist: string;
	all: boolean;
}

export const prerender = async (options: PrerenderOptions): Promise<void> => {
	const { entry, dist, all } = options;
	const alepha = await importAlepha(entry);

	const template = await readFile(`${dist}/index.html`, "utf-8").catch(
		() => "",
	);

	alepha.state("ReactServerProvider.template", template);

	const pages = alepha.getDescriptorValues({ [KIND]: "PAGE" } as any);
	for (const it of pages) {
		const pageOptions = it.value[OPTIONS];
		const page = it.value as any;

		if (pageOptions.children?.length) {
			continue;
		}

		if (!!pageOptions.prerender || all) {
			const prerenderOptions =
				typeof page[OPTIONS].prerender === "object"
					? page[OPTIONS].prerender
					: {};

			const print = async (config: any) => {
				try {
					const { html, context } = await page.render({
						withLayout: true,
						...config,
					});

					const pathname = context.url.pathname;
					const filepath = `${dist}${pathname === "/" ? "/index" : pathname}.html`;

					await mkdir(filepath.substring(0, filepath.lastIndexOf("/")), {
						recursive: true,
					});

					await writeFile(
						`${dist}${pathname === "/" ? "/index" : pathname}.html`,
						html,
					);
				} catch (error) {
					console.warn(
						new Error(
							`Prerendering page of ${it.instance.constructor.name}#${it.key} has failed`,
							{ cause: error },
						),
					);
				}
			};

			if (pageOptions.schema?.params) {
				if (prerenderOptions.entries) {
					for (const entry of prerenderOptions.entries) {
						await print(entry);
					}
				}
				continue;
			}

			await print({});
		}
	}
};
