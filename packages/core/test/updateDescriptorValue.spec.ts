import { expect, test } from "vitest";
import { Alepha, KIND, NotImplementedError } from "../src";

test("updateDescriptorValue", () => {
	const dummy = (options: { abc: number }) => {
		return {
			[KIND]: "DUMMY",
			options,
			nice: (): string => {
				throw new NotImplementedError("dummy");
			},
		};
	};

	dummy[KIND] = "DUMMY";

	class A {
		test = dummy({ abc: 123 });
	}

	const app = Alepha.create();
	const a = app.get(A);

	expect(() => a.test.nice()).toThrow(new NotImplementedError("dummy"));

	a.test = {
		...a.test,
		nice: () => `nice ${a.test.options.abc} !`,
	};

	expect(a.test.nice()).toBe("nice 123 !");
});

test("updateDescriptorValue - apply", () => {
	const dummy = (options: { abc: number }) => {
		const $ = (): string => {
			throw new NotImplementedError("dummy");
		};

		$.options = options;
		$[KIND] = "DUMMY";

		return $;
	};

	dummy[KIND] = "DUMMY";

	class A {
		test = dummy({ abc: 123 });
	}

	const app = Alepha.create();
	const a = app.get(A);

	expect(() => a.test()).toThrow(new NotImplementedError("dummy"));

	const $ = () => `nice ${a.test.options.abc} !`;

	$.options = a.test.options;
	$[KIND] = a.test[KIND];

	a.test = $;

	expect(a.test()).toBe("nice 123 !");
});
