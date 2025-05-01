import { $hook, $inject, Alepha } from "@alepha/core";
import type { PageDescriptorOptions } from "../descriptors/$page";
import { $page } from "../descriptors/$page";
import type { PageRoute, PageRouteEntry } from "../services/Router";
import { Router } from "../services/Router";

export class PageDescriptorProvider {
	protected readonly alepha = $inject(Alepha);
	protected readonly router = $inject(Router);

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
