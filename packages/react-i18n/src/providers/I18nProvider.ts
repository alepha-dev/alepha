import { $hook, $inject, $logger, Alepha, t } from "@alepha/core";
import { $cookie } from "@alepha/server-cookies";

export class I18nProvider {
	logger = $logger();
	alepha = $inject(Alepha);

	cookie = $cookie({
		name: "lang",
		schema: t.string(),
	});

	registry: Array<{
		name: string;
		lang: string;
		loader: () => Promise<Record<string, string>>;
		translations: Record<string, string>;
	}> = [];

	options = {
		fallbackLang: "en",
	};

	get languages() {
		const languages = new Set<string>();
		for (const item of this.registry) {
			languages.add(item.lang);
		}
		languages.add(this.options.fallbackLang);
		return Array.from(languages);
	}

	onRender = $hook({
		on: "server:onRequest",
		priority: "last",
		handler: async ({ request }) => {
			this.alepha.state("react.i18n.lang", this.cookie.get(request));
		},
	});

	onStart = $hook({
		on: "start",
		handler: async () => {
			if (this.alepha.isBrowser()) {
				// get cookie lang
				const cookieLang = this.cookie.get();
				if (cookieLang) {
					this.alepha.state("react.i18n.lang", cookieLang);
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

	async setLang(lang: string) {
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

		this.alepha.state("react.i18n.lang", lang);
	}

	// mutate = $hook({
	// 	on: "state:mutate",
	// 	handler: async ({ key, value }) => {
	// 		if (key === "react.i18n.lang" && this.alepha.isBrowser()) {
	// 			let hasChanged = false;
	// 			for (const item of this.registry) {
	// 				if (value === item.lang) {
	// 					if (Object.keys(item.translations).length > 0) {
	// 						continue; // already loaded
	// 					}
	// 					item.translations = await item.loader();
	// 					hasChanged = true;
	// 				}
	// 			}
	// 			if (hasChanged) {
	// 				this.alepha.state("react.i18n.lang", value);
	// 			}
	// 		}
	// 	},
	// });

	get lang(): string {
		return this.alepha.state("react.i18n.lang") || this.options.fallbackLang;
	}

	translate = (key: string, args: string[] = []) => {
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

	protected render(item: string, args: string[]): string {
		let result = item;
		for (let i = 0; i < args.length; i++) {
			result = result.replace(`$${i}`, args[i]);
		}
		return result;
	}
}
