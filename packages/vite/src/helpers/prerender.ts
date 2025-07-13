import { mkdir, readFile, writeFile } from "node:fs/promises";
import { KIND, OPTIONS } from "@alepha/core";
import { importAlepha } from "./importAlepha.ts";

export interface PrerenderOptions {
	entry: string;
	dist: string;
}

export const prerender = async (options: PrerenderOptions): Promise<void> => {
	const { entry, dist } = options;
	const alepha = await importAlepha(entry);

	const template = await readFile(`${dist}/index.html`, "utf-8").catch(
		() => "",
	);

	alepha.state("react.server.template", template);

	const pages = alepha.getDescriptorValues({ [KIND]: "PAGE" } as any);
	for (const it of pages) {
		const pageOptions = it.value[OPTIONS];
		const page = it.value as any;

		if (pageOptions.children) {
			continue;
		}

		if (pageOptions.static) {
			const prerenderOptions =
				typeof pageOptions.static === "object" ? pageOptions.static : {};

			const print = async (config: any) => {
				try {
					const { html, context } = await page.render({
						html: true,
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
