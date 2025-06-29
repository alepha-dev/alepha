import { expect, test } from "vitest";
import { $inject, Alepha } from "../src";

test("Alepha#tune", () => {
	class A {
		name = "A";
	}

	class B {
		a = $inject(A);
		getName() {
			return this.a.name;
		}
	}

	class C {
		x = "C";
	}

	const alepha = Alepha.create();
	const b = alepha.get(B);
	alepha.configure(A, { name: "B" });
	alepha.configure(C, { x: "B" });

	expect(b.getName()).toBe("B");
	expect(alepha.graph()).toEqual({
		A: {
			from: ["B", "Alepha"],
		},
		B: {
			from: ["Alepha"],
		},
	});
});

test("Alepsha#tune - substitution", () => {
	class Abstract {
		name = "Abstract";
	}

	class Impl1 implements Abstract {
		name = "Impl1";
	}

	class Impl2 implements Abstract {
		name = "Impl2";
	}

	const alepha = Alepha.create().with({ provide: Abstract, use: Impl1 });

	alepha.configure(Impl1, { name: "hey" });
	alepha.configure(Impl2, { name: "hey" });

	expect(alepha.get(Abstract).name).toBe("hey");
	expect(alepha.graph()).toEqual({
		Impl1: { from: ["Alepha"] },
		Abstract: { from: ["Alepha"], as: "Impl1" },
	});
});
