import { expect, test } from "vitest";
import { $inject, Alepha } from "../src";

test("Alepha#graph - basic ", async () => {
	class A {
		value = "a";
	}

	class B {
		a = $inject(A);
	}

	class C {
		a = $inject(A);
	}

	class M {
		b = $inject(B);
		c = $inject(C);
	}

	class A3X {
		value = "a3bis";
	}

	class A3 {
		deps = $inject(A3X);
		value = "a2";
	}

	class X {
		value = "x";
	}

	class X2 {
		value = "x2";
	}

	const a = Alepha.create();

	a.register({
		provide: A,
		use: A3,
	});

	a.register({
		provide: X,
		use: X2,
	});

	a.with(M);

	expect(a.graph()).toEqual({
		A: { from: ["Alepha", "B", "C"], as: "A3" },
		B: { from: ["M"] },
		C: { from: ["M"] },
		M: { from: ["Alepha"] },
		A3X: { from: ["A3"] },
		A3: { from: [] },
		X: { from: ["Alepha"], as: "X2" },
		X2: { from: [] },
	});
});
