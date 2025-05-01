import { expect, test } from "vitest";
import type { Class } from "../src";
import {
	$cursor,
	$inject,
	Alepha,
	CircularDependencyError,
	t,
	TypeBoxError,
} from "../src";
import { MissingContextError } from "../src/errors/MissingContextError";

test("$inject - basic", () => {
	class A {
		hello = "world";
	}

	class B {
		a = $inject(A);
	}

	class C {
		b = $inject(B);
		a = $inject(A);
	}

	const ctx = new Alepha();
	const c1 = ctx.get(C);
	expect(c1.b.a.hello).toBe("world");

	const c2 = ctx.get(C);
	c2.b.a.hello = "test";

	expect(c1.b.a.hello).toBe("test");
	expect(c2.b.a.hello).toBe("test");
	expect(c2.a.hello).toBe("test");
});

test("$inject - missing context", () => {
	class A {}

	class B {
		a = $inject(A);
	}

	expect(() => new B()).toThrow(MissingContextError);
});

test("$inject - env", () => {
	class A {
		env = $inject(
			t.object({
				N1: t.string(),
				N2: t.string({ default: "$N1" }),
			}),
		);
	}

	class B {
		a = $inject(A);
	}

	class C {
		b = $inject(B);
	}

	expect(Alepha.create({ env: { N1: "abc" } }).get(C).b.a.env).toStrictEqual({
		N1: "abc",
		N2: "abc",
	});

	expect(
		Alepha.create({ env: { N1: "abc", N2: "efg" } }).get(C).b.a.env,
	).toStrictEqual({
		N1: "abc",
		N2: "efg",
	});

	expect(() => Alepha.create().get(C)).toThrow(TypeBoxError);
});

test("$inject - circular", () => {
	const superInject = (type: Class) => {
		const { context } = $cursor();
		context.get(Module); // <- trying to "#get" during a tree walk is bad

		// consider using "#register" instead
		// register check if the type is already registered (or pending) before calling #get

		return context.get(type);
	};

	class A {}

	class Module {
		a = superInject(A);
	}

	class Test {
		hi = superInject(A);
	}

	expect(() => Alepha.create().get(Test)).toThrow(
		new CircularDependencyError("Module", ["Test"]),
	);
});

test("$inject - circular fix", () => {
	const superInject = <T extends object>(type: Class<T>): T => {
		const { context } = $cursor();
		context.register(Module); // <- replace .get by .register to fix circular dependency
		return context.get(type);
	};

	class A {
		hello = "world";
	}

	class Module {
		a = superInject(A);
	}

	class Test {
		hi = superInject(A);
	}

	expect(Alepha.create().get(Test).hi.hello).toBe("world");
});
