import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { Alepha } from "../src";

test("Alepha#inject - transient", ({ expect }) => {
	class Logger {
		id = randomUUID();
	}

	const alepha = new Alepha();

	expect(alepha.inject(Logger, { lifetime: "transient" }).id).not.toBe(
		alepha.inject(Logger, { lifetime: "transient" }).id,
	);

	const log = alepha.inject(Logger);

	expect(log.id).toBe(alepha.inject(Logger).id);

	expect(alepha.inject(Logger, { lifetime: "transient" }).id).not.toBe(log.id);
});

test("Alepha#inject - transient with substitution", ({ expect }) => {
	class BaseLogger {
		print(msg: string): string {
			return msg;
		}
	}

	class EmojiLogger extends BaseLogger {
		print(msg: string): string {
			return `${msg}😊`;
		}
	}

	const alepha = new Alepha().with({
		provide: BaseLogger,
		use: EmojiLogger,
	});

	const log = alepha.inject(BaseLogger, { lifetime: "transient" });

	expect(log).toBeInstanceOf(EmojiLogger);
	expect(log.print("Hello")).toBe("Hello😊");

	// no trace of EmojiLogger in Alepha
	expect(alepha.has(BaseLogger)).toBe(true);
	expect(alepha.has(EmojiLogger)).toBe(true);
	expect(alepha.has(BaseLogger, { inSubstitutions: false })).toBe(false);
});

test("Alepha#inject - scoped", ({ expect }) => {
	class Request {
		id = randomUUID();
	}

	const alepha = new Alepha();

	const base = alepha.inject(Request, { lifetime: "scoped" });

	expect(alepha.inject(Request, { lifetime: "scoped" }).id).toBe(base.id);

	alepha.context.run(() => {
		expect(alepha.inject(Request, { lifetime: "scoped" }).id).not.toBe(base.id);
		expect(alepha.inject(Request, { lifetime: "scoped" }).id).toBe(
			alepha.inject(Request, { lifetime: "scoped" }).id,
		);
	});
});

test("Alepha#inject - args", () => {
	class Logger {
		constructor(public a: string) {}
	}

	const alepha = new Alepha();

	expect(alepha.inject(Logger, { args: ["a"] }).a).toBe("a");
	expect(alepha.inject(Logger).a).toBe("a");
});

test("Alepha#inject - alepha", () => {
	const alepha = new Alepha();

	expect(alepha.inject(Alepha)).toBe(alepha);
});
