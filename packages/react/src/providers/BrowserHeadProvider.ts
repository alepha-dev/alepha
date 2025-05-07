import type { Head } from "./ServerHeadProvider.ts";

export class BrowserHeadProvider {
	renderHead(document: Document, head: Head): void {
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
			for (const [key, value] of Object.entries(head.meta)) {
				const meta = document.querySelector(`meta[name="${key}"]`);
				if (meta) {
					meta.setAttribute("content", value.content);
				} else {
					const newMeta = document.createElement("meta");
					newMeta.setAttribute("name", key);
					newMeta.setAttribute("content", value.content);
					document.head.appendChild(newMeta);
				}
			}
		}
	}
}
