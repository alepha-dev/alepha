import { $env, $inject, Alepha, t } from "@alepha/core";

const envSchema = t.object({
	/**
	 * Disable colors in the console output.
	 */
	NO_COLOR: t.optional(t.string()),

	/**
	 * Force color output for the application.
	 */
	FORCE_COLOR: t.optional(t.string()),
});

export class ConsoleColorProvider {
	protected readonly env = $env(envSchema);
	protected readonly alepha = $inject(Alepha);

	public readonly colors = {
		reset: "\x1b[0m",
		grey: "\x1b[90m",
		red: "\x1b[31m",
		orange: "\x1b[33m", // using yellow for orange-ish
		green: "\x1b[32m",
		blue: "\x1b[34m",
		white: "\x1b[37m",
		cyan: "\x1b[36m",
		darkGrey: "\x1b[90m", // same as grey for terminal standard
		// levels
		silent: "",
		error: "\x1b[31m",
		warn: "\x1b[33m",
		info: "\x1b[32m",
		debug: "\x1b[34m",
		trace: "\x1b[90m",
	};

	protected enabled = true;

	constructor() {
		this.enabled = this.isEnabled();
	}

	public isEnabled(): boolean {
		if (this.env.FORCE_COLOR) {
			return true;
		}

		if (this.env.NO_COLOR) {
			return false;
		}

		if (this.alepha.isProduction()) {
			return false;
		}

		return true;
	}

	public colorize(
		color: keyof typeof this.colors,
		text: string,
		reset: string = this.colors.reset,
	): string {
		if (!this.enabled) {
			return text;
		}

		return `${this.colors[color]}${text}${reset}`;
	}
}
