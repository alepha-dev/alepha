import { $hook, $inject, $logger, Alepha } from "@alepha/core";

export class I18nProvider {
	logger = $logger();
	alepha = $inject(Alepha);

	registry: Array<{
		name: string;
		lang: string;
		loader: () => Promise<Record<string, string>>;
		translations: Record<string, string>;
	}> = [];

	options = {
		fallbackLang: "en",
	};

	onRender = $hook({
		on: "server:onRequest",
		priority: "last",
		handler: async ({ request }) => {
			this.alepha.state("react.i18n.lang", request.cookies.req.lang);
		},
	});

	onStart = $hook({
		on: "start",
		handler: async () => {
			if (this.alepha.isBrowser()) {
				// get cookie lang
				const cookieLang = document.cookie
					.split("; ")
					.find((row) => row.startsWith("lang="))
					?.split("=")[1];
				if (cookieLang) {
					this.alepha.state("react.i18n.lang", cookieLang);
				}

				for (const item of this.registry) {
					if (item.lang === this.lang) {
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
			document.cookie = `lang=${lang}; path=/; max-age=31536000`; /// make server-cookies browser compatible
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

	translate = (key: string) => {
		for (const item of this.registry) {
			if (item.lang === this.lang) {
				if (item.translations[key]) {
					return item.translations[key];
				}
			}
		}
		return key; // fallback to the key itself if not found
	};
}
