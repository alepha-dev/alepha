export interface Head {
	title?: string;
	htmlAttributes?: Record<string, string>;
	bodyAttributes?: Record<string, string>;
	meta?: Array<{ name: string; content: string }>;
}

export class ServerHeadProvider {
	renderHead(template: string, head: Head): string {
		let result = template;

		// Inject htmlAttributes
		const htmlAttributes = head.htmlAttributes;
		if (htmlAttributes) {
			result = result.replace(
				/<html([^>]*)>/i,
				(_, existingAttrs) =>
					`<html${this.mergeAttributes(existingAttrs, htmlAttributes)}>`,
			);
		}

		// Inject bodyAttributes
		const bodyAttributes = head.bodyAttributes;
		if (bodyAttributes) {
			result = result.replace(
				/<body([^>]*)>/i,
				(_, existingAttrs) =>
					`<body${this.mergeAttributes(existingAttrs, bodyAttributes)}>`,
			);
		}

		// Build head content
		let headContent = "";
		const title = head.title;
		if (title) {
			if (template.includes("<title>")) {
				result = result.replace(
					/<title>(.*?)<\/title>/i,
					() => `<title>${this.escapeHtml(title)}</title>`,
				);
			} else {
				headContent += `<title>${this.escapeHtml(title)}</title>\n`;
			}
		}

		if (head.meta) {
			for (const meta of head.meta) {
				headContent += `<meta name="${this.escapeHtml(meta.name)}" content="${this.escapeHtml(meta.content)}">\n`;
			}
		}

		// Inject into <head>...</head>
		result = result.replace(
			/<head([^>]*)>(.*?)<\/head>/is,
			(_, existingAttrs, existingHead) =>
				`<head${existingAttrs}>${existingHead}${headContent}</head>`,
		);

		return result.trim();
	}

	mergeAttributes(existing: string, attrs: Record<string, string>): string {
		const existingAttrs = this.parseAttributes(existing);
		const merged = { ...existingAttrs, ...attrs };
		return Object.entries(merged)
			.map(([k, v]) => ` ${k}="${this.escapeHtml(v)}"`)
			.join("");
	}

	parseAttributes(attrStr: string): Record<string, string> {
		const attrs: Record<string, string> = {};
		const attrRegex = /([^\s=]+)(?:="([^"]*)")?/g;
		let match: RegExpExecArray | null = attrRegex.exec(attrStr);

		while (match) {
			attrs[match[1]] = match[2] ?? "";
			match = attrRegex.exec(attrStr);
		}

		return attrs;
	}

	escapeHtml(str: string): string {
		return str
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}
}
