import { expect, test } from "vitest";
import { $cursor, Alepha, descriptorEvents, KIND } from "../src";

test("autoInject", () => {
	class A {}
	class D {}

	const dummy = (options: { abc: number }) => {
		descriptorEvents.emit(D, $cursor().context);
		return {
			[KIND]: "DUMMY",
			options,
			nice: (): string => {
				return `nice ${options.abc} !`;
			},
		};
	};

	dummy.descriptor = D;

	descriptorEvents.bind(D, A);

	const app = Alepha.create();

	expect(app.has(A)).toBe(false);

	class B {
		test = dummy({
			abc: 123,
		});
	}

	const b = app.inject(B);

	expect(app.has(A)).toBe(true);
	expect(b.test.nice()).toBe("nice 123 !");
});
