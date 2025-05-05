import { $hook, $inject, Alepha } from "@alepha/core";
import type { PageDescriptorOptions } from "../descriptors/$page.ts";
import { $page } from "../descriptors/$page.ts";
import type { PageRoute, PageRouteEntry } from "../services/ReactRouter.ts";
import { ReactRouter } from "../services/ReactRouter.ts";

export class PageDescriptorProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly router = $inject(ReactRouter);

	protected readonly configure = $hook({
		name: "configure",
		handler: () => {
			const pages = this.alepha.getDescriptorValues($page);
			for (const { value, key } of pages) {
				value.options.name ??= key;

				// skip children, we only want root pages
				if (pages.find((it) => it.value.options.children?.().includes(value))) {
					continue;
				}

				this.router.add(this.map(pages, value));
			}
		},
	});

	/**
	 * Transform
	 * @param pages
	 * @param target
	 * @protected
	 */
	protected map(
		pages: Array<{ value: { options: PageDescriptorOptions } }>,
		target: { options: PageDescriptorOptions },
	): PageRouteEntry {
		const children = target.options.children?.() ?? [];

		for (const it of pages) {
			if (it.value.options.parent === target) {
				children.push(it.value);
			}
		}

		return {
			...target.options,
			parent: undefined,
			children: children.map((it) => this.map(pages, it)),
		} as PageRoute;
	}
}
