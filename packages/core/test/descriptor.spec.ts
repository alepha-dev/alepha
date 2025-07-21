import { Alepha, createDescriptor, Descriptor, KIND } from "@alepha/core";
import { expect, test } from "vitest";

test("descriptor", () => {
	class MyDescriptor extends Descriptor<{ name?: string }> {
		key() {
			return this.options.name ?? this.config.propertyKey;
		}
		identity() {
			return `${this.config.service.name}:${this.key()}`;
		}
	}

	const $my = (options: { name?: string } = {}) =>
		createDescriptor(MyDescriptor, options);

	$my[KIND] = MyDescriptor;

	class TestApp {
		h1 = $my();
		h2 = $my({ name: "hello" });
	}

	const alepha = Alepha.create();
	const app = alepha.get(TestApp);
	const h3 = alepha.use($my, { name: "h3" });

	expect(app.h1.key()).toBe("h1");
	expect(app.h2.key()).toBe("hello");
	expect(app.h2.identity()).toBe("TestApp:hello");
	expect(h3.identity()).toBe("Alepha:h3");
});
