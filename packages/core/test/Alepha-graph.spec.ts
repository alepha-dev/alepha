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

	class A2 {
		value = "a2";
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

	class Z {
		a = $inject(A);
		z = "z";
	}

	class Y {
		z = $inject(Z);
		y = "y";
	}

	class X3 extends A {
		y = $inject(Y);
	}

	const a = Alepha.create().with(M);

	a.register({
		provide: A,
		use: A2,
	});

	a.register({
		provide: A,
		use: A3,
	});

	a.register({
		provide: X,
		use: X3,
	});

	a.register({
		provide: X,
		use: X2,
	});

	expect(a.graph()).toEqual({
		A: { from: ["B", "C", "Alepha", "Z"], as: "A3" },
		B: { from: ["M"] },
		C: { from: ["M"] },
		M: { from: ["Alepha"] },
		A2: { from: [] },
		A3X: { from: ["A3"] },
		A3: { from: [] },
		Z: { from: ["Y"] },
		Y: { from: ["X3"] },
		X3: { from: [] },
		X: { from: ["Alepha"], as: "X2" },
		X2: { from: [] },
	});

	await a.start();

	expect(a.graph()).toEqual({
		A: { from: ["B", "C", "Alepha"], as: "A3" },
		B: { from: ["M"] },
		C: { from: ["M"] },
		M: { from: ["Alepha"] },
		A3X: { from: ["A3"] },
		A3: { from: [] },
		X: { from: ["Alepha"], as: "X2" },
		X2: { from: [] },
	});
});
