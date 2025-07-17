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

	a.with({
		provide: A,
		use: A3,
	});

	a.with({
		provide: X,
		use: X2,
	});

	a.with(M);

	await a.start();

	expect(a.graph()).toEqual({
		B: { from: ["M"] },
		C: { from: ["M"] },
		M: { from: ["Alepha"] },
		A3X: { from: ["A3"] },
		A3: { from: ["B", "C", "Alepha"], as: ["A"] },
		X2: { from: ["Alepha"], as: ["X"] },
	});
});
