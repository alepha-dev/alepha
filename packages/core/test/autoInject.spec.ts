import { expect, test } from "vitest";
import { __bind, __descriptor, Alepha, KIND } from "../src";

test("autoInject", () => {
	class A {}

	const dummy = (options: { abc: number }) => {
		__descriptor("DUMMY");
		return {
			[KIND]: "DUMMY",
			options,
			nice: (): string => {
				return `nice ${options.abc} !`;
			},
		};
	};

	dummy[KIND] = "DUMMY";

	__bind(dummy, A);

	const app = Alepha.create();

	expect(app.has(A)).toBe(false);

	class B {
		test = dummy({
			abc: 123,
		});
	}

	const b = app.get(B);

	expect(app.has(A)).toBe(true);
	expect(b.test.nice()).toBe("nice 123 !");
});
