import { t } from "@alepha/core";
import { $cookie } from "@alepha/server-cookies";

export class Theme {
	colorScheme = $cookie({
		schema: t.enum(["light", "dark"]),
	});

	getColorSchemeClass() {
		const colorScheme = this.colorScheme.get();
		return colorScheme === "dark"
			? "color-scheme-dark bp6-dark"
			: colorScheme === "light"
				? "color-scheme-light"
				: "";
	}

	toggleColorScheme() {
		const colorScheme = this.colorScheme.get();
		if (colorScheme === "dark") {
			document.body.classList.remove("bp6-dark"); // blueprint specific

			document.body.classList.remove("color-scheme-dark");
			document.body.classList.add("color-scheme-light");

			this.colorScheme.set("light");
		} else {
			document.body.classList.add("bp6-dark"); // blueprint specific

			document.body.classList.add("color-scheme-dark");
			document.body.classList.remove("color-scheme-light");

			this.colorScheme.set("dark");
		}
	}
}
