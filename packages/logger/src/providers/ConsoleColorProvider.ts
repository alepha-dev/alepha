import { $env, $inject, Alepha, t } from "@alepha/core";

const envSchema = t.object({
	/**
	 * Disable colors in the console output.
	 */
	NO_COLOR: t.optional(t.text()),

	/**
	 * Force color output for the application.
	 */
	FORCE_COLOR: t.optional(t.text()),
});

export class ConsoleColorProvider {
	static readonly COLORS = {
		RESET: "\x1b[0m",
		GREY: "\x1b[90m",
		RED: "\x1b[31m",
		ORANGE: "\x1b[33m", // using yellow for orange-ish
		GREEN: "\x1b[32m",
		BLUE: "\x1b[34m",
		WHITE: "\x1b[37m",
		CYAN: "\x1b[36m",
		DARK_GREY: "\x1b[90m", // same as grey for terminal standard
		// levels
		SILENT: "",
		ERROR: "\x1b[31m",
		WARN: "\x1b[33m",
		INFO: "\x1b[32m",
		DEBUG: "\x1b[34m",
		TRACE: "\x1b[90m",
	};

	protected readonly env = $env(envSchema);
	protected readonly alepha = $inject(Alepha);

	protected enabled = true;

	constructor() {
		this.enabled = this.isEnabled();
	}

	public isEnabled(): boolean {
		if (this.env.NO_COLOR) {
			return false;
		}

		if (this.env.FORCE_COLOR) {
			return true;
		}

		return !this.alepha.isProduction();
	}

	public set(
		color: keyof typeof ConsoleColorProvider.COLORS,
		text: string,
		reset: string = ConsoleColorProvider.COLORS.RESET,
	): string {
		if (!this.enabled) {
			return text;
		}

		return `${ConsoleColorProvider.COLORS[color]}${text}${reset}`;
	}
}
