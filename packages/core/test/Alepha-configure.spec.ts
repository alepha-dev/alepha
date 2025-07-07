import { expect, test } from "vitest";
import { $inject, Alepha } from "../src";

test("Alepha#tune", () => {
	class A {
		options = {
			name: "A",
		};
	}

	class B {
		a = $inject(A);
		getName() {
			return this.a.options.name;
		}
	}

	class C {
		options = {
			x: "C",
		};
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
		options = {
			name: "Abstract",
		};
	}

	class Impl1 implements Abstract {
		options = {
			name: "Impl1",
		};
	}

	class Impl2 implements Abstract {
		options = {
			name: "Impl2",
		};
	}

	const alepha = Alepha.create().with({ provide: Abstract, use: Impl1 });

	alepha.configure(Impl1, { name: "hey" });
	alepha.configure(Impl2, { name: "hey" });

	expect(alepha.get(Abstract).options.name).toBe("hey");
	expect(alepha.graph()).toEqual({
		Impl1: { from: ["Alepha"] },
		Abstract: { from: ["Alepha"], as: "Impl1" },
	});
});
