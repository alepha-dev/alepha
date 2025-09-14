import { expect, test } from "vitest";
import { $hook, $inject, Alepha } from "../src";

test("$hook - basic", async () => {
	class App {
		hook = $hook({
			on: "echo",
			handler: () => {},
		});
	}
	const alepha = Alepha.create().with(App);
	await alepha.start();
	expect(alepha.inject(App).hook.called).toBe(0);
	await alepha.events.emit("echo", {});
	expect(alepha.inject(App).hook.called).toBe(1);
	await alepha.events.emit("echo", {});
	expect(alepha.inject(App).hook.called).toBe(2);
});

test("$hook - with swapping", async () => {
	let count = 0;

	class Interface {
		n = 10;
		c = $hook({
			on: "configure",
			handler: () => {
				count += this.n;
			},
		});
	}

	const app = new Alepha();

	expect(count).toBe(0);

	class Impl extends Interface {
		n = 1;
		id = Math.random();
	}

	app.with({
		provide: Interface,
		use: Impl, // expects to be swapped, event from "Interface" will be deleted
	});

	expect(count).toBe(0);

	await app.start();

	expect(count).toBe(1);
});

test("$hook - priority/before/after", async () => {
	let stack = "";

	class A {
		_ = $hook({
			on: "configure",
			handler: () => {
				stack += "A";
			},
		});
	}

	class B {
		a = $inject(A);
		_ = $hook({
			on: "configure",
			after: [this.a],
			handler: () => {
				stack += "B";
			},
		});
	}

	class C {
		b = $inject(B);
		_ = $hook({
			on: "configure",
			after: [this.b],
			handler: () => {
				stack += "C";
			},
		});
	}

	class D {
		b = $inject(B);
		c = $inject(C);
		_ = $hook({
			on: "configure",
			after: [this.b, this.c],
			handler: () => {
				stack += "D";
			},
		});
	}

	class E {
		d = $inject(D);
		f = $inject(F);
		_ = $hook({
			on: "configure",
			after: [this.d],
			before: [this.f],
			handler: () => {
				stack += "E";
			},
		});
	}

	class F {
		_ = $hook({
			priority: "last",
			on: "configure",
			handler: () => {
				stack += "F";
			},
		});
	}

	const alepha = Alepha.create().with(F).with(B).with(E);

	await alepha.start();

	expect(stack).toBe("ABCDEF");
});
