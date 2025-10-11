import { $hook, $inject, Alepha, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { $cookie } from "@alepha/server-cookies";
import type { ServiceDictionary } from "../hooks/useI18n.ts";

export class I18nProvider<
	S extends object,
	K extends keyof ServiceDictionary<S>,
> {
	protected logger = $logger();
	protected alepha = $inject(Alepha);

	protected cookie = $cookie({
		name: "lang",
		schema: t.text(),
	});

	public readonly registry: Array<{
		name: string;
		lang: string;
		loader: () => Promise<Record<string, string>>;
		translations: Record<string, string>;
	}> = [];

	options = {
		fallbackLang: "en",
	};

	public numberFormat: { format: (value: number) => string } =
		new Intl.NumberFormat(this.lang);

	public get languages() {
		const languages = new Set<string>();

		for (const item of this.registry) {
			languages.add(item.lang);
		}
		languages.add(this.options.fallbackLang);

		return Array.from(languages);
	}

	protected readonly onRender = $hook({
		on: "server:onRequest",
		priority: "last",
		handler: async ({ request }) => {
			this.alepha.state.set("react.i18n.lang", this.cookie.get(request));
		},
	});

	protected readonly onStart = $hook({
		on: "start",
		handler: async () => {
			if (this.alepha.isBrowser()) {
				// get cookie lang
				const cookieLang = this.cookie.get();
				if (cookieLang) {
					this.alepha.state.set("react.i18n.lang", cookieLang);
				}

				for (const item of this.registry) {
					if (
						item.lang === this.lang ||
						item.lang === this.options.fallbackLang
					) {
						item.translations = await item.loader();
					}
				}
				return;
			}

			for (const item of this.registry) {
				item.translations = await item.loader();
			}
		},
	});

	protected createFormatters() {
		this.numberFormat = new Intl.NumberFormat(this.lang);
	}

	public async setLang(lang: string) {
		if (this.alepha.isBrowser()) {
			for (const item of this.registry) {
				if (lang === item.lang) {
					if (Object.keys(item.translations).length > 0) {
						continue; // already loaded
					}
					item.translations = await item.loader();
				}
			}
			this.cookie.set(lang);
		}

		this.alepha.state.set("react.i18n.lang", lang);
	}

	protected readonly mutate = $hook({
		on: "state:mutate",
		handler: async ({ key, value }) => {
			if (key === "react.i18n.lang" && this.alepha.isBrowser()) {
				let hasChanged = false;
				for (const item of this.registry) {
					if (value === item.lang) {
						if (Object.keys(item.translations).length > 0) {
							continue; // already loaded
						}
						item.translations = await item.loader();
						hasChanged = true;
					}
				}

				this.createFormatters();

				if (hasChanged) {
					this.alepha.state.set("react.i18n.lang", value);
				}
			}
		},
	});

	public get lang(): string {
		return (
			this.alepha.state.get("react.i18n.lang") || this.options.fallbackLang
		);
	}

	public translate = (key: string, args: string[] = []) => {
		for (const item of this.registry) {
			if (item.lang === this.lang) {
				if (item.translations[key]) {
					return this.render(item.translations[key], args); // append lang for fallback
				} else {
					break;
				}
			}
		}

		for (const item of this.registry) {
			if (item.lang === this.options.fallbackLang) {
				if (item.translations[key]) {
					return this.render(item.translations[key], args); // append lang for fallback
				} else {
					break;
				}
			}
		}

		return key; // fallback to the key itself if not found
	};

	public readonly tr = (
		key: keyof ServiceDictionary<S>[K] | string,
		options: {
			args?: string[];
			default?: string;
		} = {},
	) => {
		const translation = this.translate(key as string, options.args || []);
		if (translation === key && options.default) {
			return options.default;
		}
		return translation;
	};

	protected render(item: string, args: string[]): string {
		let result = item;
		for (let i = 0; i < args.length; i++) {
			result = result.replace(`$${i + 1}`, args[i]);
		}
		return result;
	}
}
