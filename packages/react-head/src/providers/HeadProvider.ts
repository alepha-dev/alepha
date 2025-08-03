import type { PageReactContext, PageRoute, RouterState } from "@alepha/react";
import type { Head } from "../interfaces/Head.ts";

export class HeadProvider {
	public global?: Head | (() => Head);

	protected getGlobalHead(): Head | undefined {
		if (typeof this.global === "function") {
			return this.global();
		}
		return this.global;
	}

	public fillHead(state: RouterState, context: PageReactContext) {
		context.head = {
			...context.head,
			...this.getGlobalHead(),
		};

		for (const layer of state.layers) {
			if (layer.route?.head && !layer.error) {
				this.fillHeadByPage(layer.route, context, layer.props ?? {});
			}
		}
	}

	protected fillHeadByPage(
		page: PageRoute,
		context: PageReactContext,
		props: Record<string, any>,
	): void {
		if (!page.head) {
			return;
		}

		context.head ??= {};

		const head =
			typeof page.head === "function"
				? page.head(props, context.head)
				: page.head;

		if (head.title) {
			context.head ??= {};

			if (context.head.titleSeparator) {
				context.head.title = `${head.title}${context.head.titleSeparator}${context.head.title}`;
			} else {
				context.head.title = head.title;
			}

			context.head.titleSeparator = head.titleSeparator;
		}

		if (head.htmlAttributes) {
			context.head.htmlAttributes = {
				...context.head.htmlAttributes,
				...head.htmlAttributes,
			};
		}

		if (head.bodyAttributes) {
			context.head.bodyAttributes = {
				...context.head.bodyAttributes,
				...head.bodyAttributes,
			};
		}

		if (head.meta) {
			context.head.meta = [...(context.head.meta ?? []), ...(head.meta ?? [])];
		}
	}
}
