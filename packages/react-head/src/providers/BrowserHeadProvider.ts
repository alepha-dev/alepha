import { $hook, $inject } from "@alepha/core";
import type { Head } from "../interfaces/Head";
import { HeadProvider } from "./HeadProvider.ts";

export class BrowserHeadProvider {
	protected readonly headProvider = $inject(HeadProvider);

	protected get document(): Document {
		return window.document;
	}

	protected readonly onBrowserRender = $hook({
		on: "react:browser:render",
		handler: async ({ state, context }) => {
			this.headProvider.fillHead(state, context);
			if (context.head) {
				this.renderHead(this.document, context.head);
			}
		},
	});

	protected readonly onTransitionEnd = $hook({
		on: "react:transition:end",
		handler: async ({ state, context }) => {
			this.headProvider.fillHead(state, context);
			if (context.head) {
				this.renderHead(this.document, context.head);
			}
		},
	});

	public renderHead(document: Document, head: Head): void {
		if (head.title) {
			document.title = head.title;
		}

		if (head.bodyAttributes) {
			for (const [key, value] of Object.entries(head.bodyAttributes)) {
				if (value) {
					document.body.setAttribute(key, value);
				} else {
					document.body.removeAttribute(key);
				}
			}
		}

		if (head.htmlAttributes) {
			for (const [key, value] of Object.entries(head.htmlAttributes)) {
				if (value) {
					document.documentElement.setAttribute(key, value);
				} else {
					document.documentElement.removeAttribute(key);
				}
			}
		}

		if (head.meta) {
			for (const it of head.meta) {
				const { name, content } = it;
				const meta = document.querySelector(`meta[name="${name}"]`);
				if (meta) {
					meta.setAttribute("content", content);
				} else {
					const newMeta = document.createElement("meta");
					newMeta.setAttribute("name", name);
					newMeta.setAttribute("content", content);
					document.head.appendChild(newMeta);
				}
			}
		}
	}
}
