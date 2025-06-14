import { expect, test } from "vitest";
import { $inject, Alepha } from "../src";
import { AlephaError } from "../src/errors/AlephaError.ts";

/**
 * Basic class swapping.
 *
 * This feature replaces the class with another class.
 * TypeScript check type compatibility.
 */
test("Alepha#register - basic swapping", () => {
	class A {
		value = "a";
	}

	class M {
		a = $inject(A);
	}

	expect(
		Alepha.create()
			.register({
				provide: A,
				use: class extends A {
					value = "z";
				},
			})
			.get(M).a.value,
	).toBe("z");
});

test("Alepha#register - default", () => {
	class A {
		a = "a";
	}
	class B {
		a = "b";
	}
	class C {
		a = "c";
	}

	class M {
		a = $inject(A);
	}

	const T1 = Alepha.create().with(M);
	expect(T1.get(M).a.a).toBe("a");

	const T2 = Alepha.create().register({
		provide: A,
		use: B,
	});
	expect(T2.get(M).a.a).toBe("b");

	const T3 = Alepha.create();
	T3.register({
		provide: A,
		use: C,
		default: true,
	});
	expect(T3.get(M).a.a).toBe("c");

	const T4 = Alepha.create();
	T4.with(M);
	T4.register({
		provide: A,
		use: C,
		default: true,
	});
	expect(T1.get(M).a.a).toBe("a");

	const T5 = Alepha.create();
	T5.with(M);
	expect(() =>
		T5.register({
			provide: A,
			use: C,
			default: false, // should throw, because the default is already set
		}),
	).toThrow(AlephaError);
});
