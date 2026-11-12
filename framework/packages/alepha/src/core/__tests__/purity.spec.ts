import {
  $hook,
  $inject,
  $module,
  Alepha,
  AlephaError,
  createPrimitive,
  Primitive,
  type PrimitiveSide,
  type PurityEntry,
  type Service,
} from "alepha";
import { $action, AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

/**
 * A boot primitive, declared as such.
 */
class BootThing extends Primitive<{}> {
  public static override readonly side: PrimitiveSide = "boot";
}

/**
 * A primitive kind that declares no side: it counts as boot.
 */
class UnclassifiedThing extends Primitive<{}> {}

/**
 * A primitive that does nothing until it is called.
 */
class InertThing extends Primitive<{}> {
  public static override readonly side: PrimitiveSide = "inert";
}

const $boot = () => createPrimitive(BootThing, {});
const $unclassified = () => createPrimitive(UnclassifiedThing, {});
const $inert = () => createPrimitive(InertThing, {});

const ping = () =>
  $action({ method: "GET", path: `/ping/${Math.random()}`, handler: () => "" });

const entryOf = (alepha: Alepha, service: Service): PurityEntry => {
  const entry = alepha.purity().find((it) => it.service === service);
  if (!entry) {
    throw new AlephaError(`no purity entry for ${service.name}`);
  }
  return entry;
};

describe("Alepha.purity", () => {
  it("calls a controller registered by a module, holding only actions, pure", ({
    expect,
  }) => {
    class Api {
      list = ping();
    }
    const alepha = Alepha.create().with(
      $module({ name: "test.api", services: [Api] }),
    );
    expect(entryOf(alepha, Api)).toEqual({
      service: Api,
      pure: true,
      reasons: [],
      closure: [],
    });
  });

  it("calls a controller holding a $hook not pure", ({ expect }) => {
    class Api {
      list = ping();
      boot = $hook({ on: "start", handler: () => {} });
    }
    const alepha = Alepha.create().with(Api);
    expect(entryOf(alepha, Api)).toMatchObject({
      pure: false,
      reasons: ["holds a $hook"],
    });
  });

  it("calls a controller registering a listener while constructed not pure, without $hook", ({
    expect,
  }) => {
    class Api {
      alepha = $inject(Alepha);
      list = ping();
      constructor() {
        this.alepha.events.on("start", () => {});
      }
    }
    const alepha = Alepha.create().with(Api);
    expect(entryOf(alepha, Api)).toMatchObject({
      pure: false,
      reasons: ["registers an event listener while it is constructed"],
    });
  });

  it("calls a controller holding a boot primitive, or an unclassified one, not pure", ({
    expect,
  }) => {
    class Booting {
      list = ping();
      thing = $boot();
    }
    class Unknown {
      list = ping();
      thing = $unclassified();
    }
    const alepha = Alepha.create().with(Booting).with(Unknown);
    expect(entryOf(alepha, Booting).reasons).toEqual(["holds a $bootThing"]);
    expect(entryOf(alepha, Unknown).reasons).toEqual([
      "holds a $unclassifiedThing",
    ]);
  });

  it("calls a controller not pure when it alone brings a module in", ({
    expect,
  }) => {
    // Deferred, the class would bring the module in after the lock, where
    // its `register` can no longer add a provider: the ssr example's
    // CountApi, whose `$repository` alone brought the ORM module in.
    class Store {}
    $module({ name: "test.storage", services: [Store] });
    class Api {
      store = $inject(Store);
      list = ping();
    }
    const alepha = Alepha.create().with(Api);
    expect(entryOf(alepha, Api).pure).toBe(false);
    expect(entryOf(alepha, Api).reasons.join(" ")).toMatch(/test\.storage/);
  });

  it("keeps a controller pure when registration brought its module in", ({
    expect,
  }) => {
    class Store {}
    const Storage = $module({ name: "test.storage2", services: [Store] });
    class Api {
      store = $inject(Store);
      list = ping();
    }
    const alepha = Alepha.create().with(Storage).with(Api);
    expect(entryOf(alepha, Api).pure).toBe(true);
  });

  it("keeps a controller holding an inert primitive pure", ({ expect }) => {
    class Api {
      list = ping();
      thing = $inert();
    }
    const alepha = Alepha.create().with(Api);
    expect(entryOf(alepha, Api).pure).toBe(true);
  });

  it("calls a controller injected by a service not pure, naming the service, and sticky", ({
    expect,
  }) => {
    class Api {
      list = ping();
    }
    class Uses {
      api = $inject(Api);
    }
    const alepha = Alepha.create()
      .with($module({ name: "test.api", services: [Api] }))
      .with(Uses);
    expect(entryOf(alepha, Api)).toMatchObject({
      pure: false,
      reasons: ["injected by Uses"],
    });
  });

  it("keeps a controller injected by a pure controller pure, and chains a service up the line", ({
    expect,
  }) => {
    class Inner {
      list = ping();
    }
    class Outer {
      inner = $inject(Inner);
      list = ping();
    }
    const clean = Alepha.create().with(Outer);
    expect(entryOf(clean, Inner).pure).toBe(true);
    expect(entryOf(clean, Outer).pure).toBe(true);

    class Service1 {
      outer = $inject(Outer);
    }
    const dirty = Alepha.create().with(Service1);
    expect(entryOf(dirty, Outer).reasons).toEqual(["injected by Service1"]);
    expect(entryOf(dirty, Inner).reasons).toEqual([
      "injected by Outer, which is not pure",
    ]);
  });

  it("attributes a helper's alepha.inject to the class under construction", ({
    expect,
  }) => {
    class Parent {
      list = ping();
    }
    // What a page helper does: a bare `alepha.inject` from a field
    // initialiser, while its router is being constructed. The container's
    // `parent` for it is the module; the injector is the router.
    class Helped {
      alepha = $inject(Alepha);
      parent = this.alepha.inject(Parent);
      list = ping();
    }
    class Service1 {
      alepha = $inject(Alepha);
      parent = this.alepha.inject(Parent);
    }
    const clean = Alepha.create().with(
      $module({ name: "test.pages", register: (a) => a.with(Helped) }),
    );
    expect(entryOf(clean, Parent).pure).toBe(true);

    const dirty = Alepha.create().with(
      $module({ name: "test.pages", register: (a) => a.with(Service1) }),
    );
    expect(entryOf(dirty, Parent).reasons).toEqual(["injected by Service1"]);
  });

  it("treats services, alepha.with and alepha.inject in register as registration", ({
    expect,
  }) => {
    class A {
      list = ping();
    }
    class B {
      list = ping();
    }
    class C {
      list = ping();
    }
    const alepha = Alepha.create().with(
      $module({
        name: "test.forms",
        services: [A],
        register: (it) => {
          it.with(B);
          it.inject(C);
        },
      }),
    );
    for (const service of [A, B, C]) {
      expect(entryOf(alepha, service).pure, service.name).toBe(true);
    }
  });

  it("does not count a module pulled in by an injection as injected by the class on the stack", ({
    expect,
  }) => {
    class Listed {
      list = ping();
    }
    class Shared {
      // A class of a module that is not registered yet: injecting it
      // registers the module first, which creates `Listed`.
      value = 1;
    }
    const Mod = $module({ name: "test.pulled", services: [Listed, Shared] });
    class Caller {
      shared = $inject(Shared);
    }
    // The server module registered up front, as an app does: otherwise
    // `Listed`'s action alone would bring it in, which is not pure (#Q3485).
    const alepha = Alepha.create().with(AlephaServer).with(Caller);
    expect(Mod).toBeDefined();
    expect(entryOf(alepha, Listed).pure).toBe(true);
  });

  it("returns a pure controller's late closure, and refuses one holding a boot class", ({
    expect,
  }) => {
    class Helper {
      value = 1;
    }
    class Deep {
      value = 2;
    }
    class Indexer {
      deep = $inject(Deep);
    }
    class Api {
      helper = $inject(Helper);
      indexer = $inject(Indexer);
      list = ping();
    }
    const clean = Alepha.create().with(Api);
    expect(entryOf(clean, Api).pure).toBe(true);
    expect(
      entryOf(clean, Api)
        .closure.map((it) => it.name)
        .sort(),
    ).toEqual(["Deep", "Helper", "Indexer"]);

    class HookedDeep {
      boot = $hook({ on: "start", handler: () => {} });
    }
    class HookedIndexer {
      deep = $inject(HookedDeep);
    }
    class Hooked {
      indexer = $inject(HookedIndexer);
      list = ping();
    }
    const dirty = Alepha.create().with(Hooked);
    expect(entryOf(dirty, Hooked)).toMatchObject({
      pure: false,
      reasons: ["it alone creates HookedDeep, which holds a $hook"],
      closure: [],
    });
  });

  it("counts a class a primitive's onInit registers as registration, not an injection by its holder", ({
    expect,
  }) => {
    class Feature {
      list = ping();
    }
    // What `$realm({ features })` does: its onInit passes the feature's
    // controller to `alepha.with`, while the class declaring it is on the
    // stack.
    class Registering extends Primitive<{}> {
      public static override readonly side: PrimitiveSide = "boot";
      protected override onInit() {
        this.alepha.with(Feature);
      }
    }
    class Holder {
      realm = createPrimitive(Registering, {});
    }
    const alepha = Alepha.create().with(Holder);
    expect(entryOf(alepha, Feature).pure).toBe(true);
  });

  it("leaves a service out of the late closure once a module registers it", ({
    expect,
  }) => {
    class HookedIndexer {
      boot = $hook({ on: "start", handler: () => {} });
    }
    class Api {
      indexer = $inject(HookedIndexer);
      list = ping();
    }
    const alepha = Alepha.create().with(
      $module({ name: "test.listed", services: [HookedIndexer, Api] }),
    );
    expect(entryOf(alepha, Api)).toMatchObject({ pure: true, closure: [] });
  });
});
