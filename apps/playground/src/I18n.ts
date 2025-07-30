import { $dictionary } from "@alepha/react-i18n";

export class I18n {
	en = $dictionary({
		lazy: () => import("../i18n/en.ts").then((it) => ({ default: it.en })),
	});

	fr = $dictionary({
		lazy: () => import("../i18n/fr.ts"),
	});
}
