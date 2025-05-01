import { expect, test } from "vitest";
import { $inject, Alepha } from "../src";

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

test("Alepha#register - late swapping", () => {
	class A {
		value = "a";
	}

	class M {
		a = $inject(A);
	}

	expect(
		Alepha.create()
			.register(M) // Register M first, so A is also registered.
			.register({
				provide: A, // Oops, we registered A again.
				use: class extends A {
					value = "z";
				},
			})
			.get(M).a.value,
	).toBe("z");
});

test("Alepha#register - default", () => {
	const alepha = Alepha.create();

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

	alepha.register(A);

	alepha.register({
		provide: A,
		use: B,
		default: true,
	});

	expect(alepha.get(M).a.a).toBe("b");

	alepha.register({
		provide: A,
		use: C,
	});

	alepha.register(A);

	expect(alepha.get(M).a.a).toBe("c");

	alepha.register({
		provide: A,
		use: B,
		default: true,
	});

	expect(alepha.get(M).a.a).toBe("c");
});

test("Alepha#register - late swapping + default", async () => {
	class Pro {
		pro = "pro";
	}

	class ProExt extends Pro {}

	class ProA {
		pro = "a";
	}

	class ProB {
		pro = "b";
	}

	class App {
		pro_ext = $inject(ProExt);
		pro = $inject(Pro);
		test = () => this.pro_ext.pro + this.pro.pro;
	}

	class M {
		a = $inject(Alepha);

		constructor() {
			this.a.with({
				provide: Pro,
				use: ProA,
				default: true,
			});
			this.a.with({
				provide: ProExt,
				use: ProA,
				default: true,
			});
		}
	}

	const test = async (a: Alepha) => {
		const app = a.get(App);
		await a.start();
		return app.test();
	};

	expect(await test(Alepha.create().with(M).with(App))).toBe("aa");

	expect(
		await test(
			Alepha.create().with(M).with(App).with({
				provide: ProExt,
				use: ProB,
			}),
		),
	).toBe("ba");

	expect(
		await test(
			Alepha.create().with(App).with(M).with({
				provide: ProExt,
				use: ProB,
			}),
		),
	).toBe("ba");

	expect(
		await test(
			Alepha.create().with(M).with({
				provide: ProExt,
				use: ProB,
			}),
		),
	).toBe("ba");

	expect(
		await test(
			Alepha.create()
				.with(App)
				.with({
					provide: ProExt,
					use: ProB,
				})
				.with(M),
		),
	).toBe("ba");
});
