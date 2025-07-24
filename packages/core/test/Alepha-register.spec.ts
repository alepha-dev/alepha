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
			.with({
				provide: A,
				use: class extends A {
					value = "z";
				},
			})
			.inject(M).a.value,
	).toBe("z");
});

test("Alepha#register - optional", () => {
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
	expect(T1.inject(M).a.a).toBe("a");

	const T2 = Alepha.create().with({
		provide: A,
		use: B,
	});
	expect(T2.inject(M).a.a).toBe("b");

	const T3 = Alepha.create();
	T3.with({
		provide: A,
		use: C,
		optional: true,
	});
	expect(T3.inject(M).a.a).toBe("c");

	const T4 = Alepha.create();
	T4.with(M);
	T4.with({
		provide: A,
		use: C,
		optional: true,
	});
	expect(T1.inject(M).a.a).toBe("a");

	const T5 = Alepha.create();
	T5.with(M);
	expect(() =>
		T5.with({
			provide: A,
			use: C,
			optional: false, // should throw, because the default is already set
		}),
	).toThrow(AlephaError);
});
