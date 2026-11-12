import { MODULE } from "alepha/internal";

import type { Service } from "../interfaces/Service.ts";
import type { Primitive } from "./primitive.ts";

/**
 * What a primitive kind means for the class holding it (#Q3395).
 *
 * - `table`: served on request (`$action`, `$page`, `$tool`, ...). A class
 *   holding one is a controller, and the build lists it.
 * - `boot`: acts at boot, or fills a registry read at boot (`$hook`, `$job`,
 *   `$permission`, ...). A class holding one is created at boot.
 * - `inert`: does nothing until it is called (`$cache`, `$sequence`, ...). It
 *   changes nothing for purity.
 *
 * A kind declares its side with a static `side`; an undeclared kind counts as
 * `boot`, so a primitive nobody classified never makes a class late.
 */
export type PrimitiveSide = "table" | "boot" | "inert";

/**
 * One class the container created, as the purity read sees it.
 */
export interface ContainerClassRecord {
  service: Service;
  /**
   * Who injected it. `null` is a registration: `services: [X]`,
   * `alepha.with(X)` or `alepha.inject(X)` made by a module's `register`, or
   * by code that runs outside any construction.
   */
  injectors: Set<Service | null>;
  /**
   * The primitive kinds the class holds, with their count.
   */
  kinds: Map<Service<Primitive>, number>;
  /**
   * Whether the class registered an event listener while it was constructed,
   * through `$hook` or by reaching `alepha.events` itself.
   */
  listens: boolean;
}

/**
 * The purity answer for one class holding a table primitive.
 */
export interface PurityEntry {
  service: Service;
  pure: boolean;
  /**
   * Why it is not pure, each reason naming the other class or the primitive.
   * Empty when pure.
   */
  reasons: string[];
  /**
   * For a pure class: the classes that exist only because pure classes
   * created them, reachable from this one. Empty when not pure.
   */
  closure: Service[];
}

/**
 * Who created whom in a container, and what each class holds (#Q3395).
 *
 * Recorded while the app loads, read once by {@link ContainerGraph.purity}:
 * the build reads it from a loaded container that never starts, so nothing
 * here depends on `configure` or `start`.
 *
 * Attribution follows the construction stack, not the `parent` an injection
 * names. An injection made while a class is under construction belongs to
 * that class, whichever way it reached `inject` (a helper such as a page
 * guard calling `alepha.inject` injects on behalf of its caller). A module's
 * `register` opens a new frame: what it creates is its registration, even
 * when an injection pulled the module in while another class was on the
 * stack.
 */
export class ContainerGraph {
  /**
   * @param skip - Classes never recorded and never an injector: primitives
   * (their owner is the class they are declared on) and modules (what a
   * module creates is its registration).
   */
  protected readonly skip: (service: Service) => boolean;

  constructor(skip: (service: Service) => boolean) {
    this.skip = skip;
  }

  protected readonly records = new Map<Service, ContainerClassRecord>();

  /**
   * Every class whose injection reached a service of each module, `null`
   * for a registration (#Q3485). A module reached only by pure classes is
   * registered while one of them is constructed; deferred, they would bring
   * it in after the lock, where its `register` can no longer add a
   * provider.
   */
  protected readonly modulesBy = new Map<Service, Set<Service | null>>();

  /**
   * The stack depth at which each open `register` frame started.
   */
  protected readonly frames: number[] = [0];

  public get classes(): ReadonlyMap<Service, ContainerClassRecord> {
    return this.records;
  }

  public clear(): void {
    this.records.clear();
    this.modulesBy.clear();
    this.frames.length = 1;
    this.frames[0] = 0;
  }

  /**
   * Opens a registration frame at the given stack depth.
   */
  public openFrame(depth: number): void {
    this.frames.push(depth);
  }

  public closeFrame(): void {
    if (this.frames.length > 1) {
      this.frames.pop();
    }
  }

  /**
   * The class an injection made now belongs to: the class under
   * construction at the top of the current frame, or `null` for a
   * registration.
   *
   * A primitive under construction is not a class an app wrote: what it
   * injects is its own plumbing (`$action` reaching the router), created
   * whichever class declares it, so it counts as registration too.
   */
  public injectorOf(stack: ReadonlyArray<Service>): Service | null {
    const base = this.frames[this.frames.length - 1];
    const top = stack.length - 1;
    if (top < base || this.skip(stack[top])) {
      return null;
    }
    return stack[top];
  }

  /**
   * The class that reaches a module now: the nearest class under
   * construction within the current frame that is not a primitive, or `null`
   * for a registration (#Q3485). Unlike {@link injectorOf}, a primitive's
   * plumbing reaching a module counts against the class declaring it: a
   * `$page` alone is what brings the React router in, and deferred with its
   * class it would arrive after the lock.
   */
  public moduleReacherOf(stack: ReadonlyArray<Service>): Service | null {
    const base = this.frames[this.frames.length - 1];
    for (let i = stack.length - 1; i >= base; i--) {
      if (!this.skip(stack[i])) {
        return stack[i];
      }
    }
    return null;
  }

  /**
   * The class a primitive being initialised now belongs to: the nearest
   * class under construction that is not itself a primitive.
   */
  public ownerOf(stack: ReadonlyArray<Service>): Service | null {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!this.skip(stack[i])) {
        return stack[i];
      }
    }
    return null;
  }

  public injected(service: Service, injector: Service | null): void {
    if (this.skip(service)) {
      return;
    }
    const record = this.recordOf(service);
    if (injector !== service) {
      record.injectors.add(injector);
    }
  }

  /**
   * A module reached by a class's injection of one of its services, or by
   * a registration (`null`).
   */
  public moduleReached(module: Service, injector: Service | null): void {
    let reachers = this.modulesBy.get(module);
    if (!reachers) {
      reachers = new Set();
      this.modulesBy.set(module, reachers);
    }
    reachers.add(injector);
  }

  public primitive(owner: Service | null, kind: Service<Primitive>): void {
    if (!owner) {
      return;
    }
    const record = this.recordOf(owner);
    record.kinds.set(kind, (record.kinds.get(kind) ?? 0) + 1);
  }

  public listened(owner: Service | null): void {
    if (owner) {
      this.recordOf(owner).listens = true;
    }
  }

  /**
   * Every class holding a table primitive: pure, or why not.
   */
  public purity(): PurityEntry[] {
    const records = [...this.records.values()];
    const tables = records.filter((it) => this.holds(it, "table"));
    const own = new Map<Service, string[]>();
    for (const record of tables) {
      own.set(record.service, this.ownReasons(record));
    }

    const reasons = new Map<Service, string[]>();
    for (const record of tables) {
      reasons.set(record.service, [...own.get(record.service)!]);
    }
    let pure = new Set(
      tables
        .filter((it) => reasons.get(it.service)!.length === 0)
        .map((it) => it.service),
    );

    for (;;) {
      const late = this.lateClasses(pure);
      const failing = new Map<Service, string>();

      // A table class injected by anything but registration or a pure class.
      for (const service of pure) {
        const record = this.records.get(service)!;
        for (const injector of record.injectors) {
          if (injector === null || pure.has(injector)) {
            continue;
          }
          const why = this.holds(this.records.get(injector), "table")
            ? `injected by ${injector.name}, which is not pure`
            : `injected by ${injector.name}`;
          failing.set(service, why);
          break;
        }
      }

      // A module brought in by a pure class, or by a late class only pure
      // classes reach, makes them not pure (#Q3485): deferred, they would
      // bring it in after the lock.
      for (const [module, reachers] of this.modulesBy) {
        // A registration, or a class created at boot, brings it in anyway.
        const atBoot = [...reachers].some(
          (it) => it === null || (!pure.has(it) && !late.has(it)),
        );
        if (atBoot) {
          continue;
        }
        for (const reacher of reachers) {
          const owners = pure.has(reacher!)
            ? [reacher!]
            : this.ownersOf(reacher!, pure, late);
          for (const owner of owners) {
            if (!failing.has(owner)) {
              failing.set(
                owner,
                `it alone brings in the module ${module.name}`,
              );
            }
          }
        }
      }

      // A late class that would be a boot class makes every pure class that
      // reaches it not pure.
      for (const service of late) {
        const record = this.records.get(service)!;
        const what = this.bootReason(record);
        if (!what) {
          continue;
        }
        for (const owner of this.ownersOf(service, pure, late)) {
          if (!failing.has(owner)) {
            failing.set(
              owner,
              `it alone creates ${service.name}, which ${what}`,
            );
          }
        }
      }

      if (failing.size === 0) {
        const entries: PurityEntry[] = [];
        for (const record of tables) {
          const isPure = pure.has(record.service);
          entries.push({
            service: record.service,
            pure: isPure,
            reasons: isPure ? [] : reasons.get(record.service)!,
            closure: isPure ? this.closureOf(record.service, late) : [],
          });
        }
        return entries;
      }

      for (const [service, why] of failing) {
        reasons.get(service)!.push(why);
        pure.delete(service);
      }
      pure = new Set(pure);
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected recordOf(service: Service): ContainerClassRecord {
    let record = this.records.get(service);
    if (!record) {
      record = {
        service,
        injectors: new Set(),
        kinds: new Map(),
        listens: false,
      };
      this.records.set(service, record);
    }
    return record;
  }

  protected holds(
    record: ContainerClassRecord | undefined,
    side: PrimitiveSide,
  ): boolean {
    if (!record) {
      return false;
    }
    for (const kind of record.kinds.keys()) {
      if (ContainerGraph.sideOf(kind) === side) {
        return true;
      }
    }
    return false;
  }

  /**
   * What makes a class a boot class by itself: a `$hook`, a listener, or a
   * boot primitive. Undefined when nothing does.
   */
  protected bootReason(record: ContainerClassRecord): string | undefined {
    for (const kind of record.kinds.keys()) {
      if (ContainerGraph.sideOf(kind) === "boot") {
        return `holds a ${ContainerGraph.kindName(kind)}`;
      }
    }
    if (record.listens) {
      return "registers an event listener while it is constructed";
    }
    return undefined;
  }

  protected ownReasons(record: ContainerClassRecord): string[] {
    const reasons: string[] = [];
    for (const kind of record.kinds.keys()) {
      if (ContainerGraph.sideOf(kind) === "boot") {
        reasons.push(`holds a ${ContainerGraph.kindName(kind)}`);
      }
    }
    if (record.listens && !reasons.includes("holds a $hook")) {
      reasons.push("registers an event listener while it is constructed");
    }
    return reasons;
  }

  /**
   * The classes that exist only because pure classes created them: never
   * registered, holding no table primitive, and injected only by pure classes
   * or by other such classes.
   */
  protected lateClasses(pure: Set<Service>): Set<Service> {
    const late = new Set<Service>();
    for (const record of this.records.values()) {
      if (
        !pure.has(record.service) &&
        !this.holds(record, "table") &&
        record.injectors.size > 0 &&
        !record.injectors.has(null)
      ) {
        late.add(record.service);
      }
    }
    for (let changed = true; changed;) {
      changed = false;
      for (const service of late) {
        for (const injector of this.records.get(service)!.injectors) {
          if (injector && !pure.has(injector) && !late.has(injector)) {
            late.delete(service);
            changed = true;
            break;
          }
        }
      }
    }
    return late;
  }

  /**
   * The pure classes a late class exists for, through any chain of late
   * classes.
   */
  protected ownersOf(
    service: Service,
    pure: Set<Service>,
    late: Set<Service>,
  ): Set<Service> {
    const owners = new Set<Service>();
    const seen = new Set<Service>();
    const queue = [service];
    while (queue.length) {
      const current = queue.pop()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      for (const injector of this.records.get(current)?.injectors ?? []) {
        if (!injector) {
          continue;
        }
        if (pure.has(injector)) {
          owners.add(injector);
        } else if (late.has(injector)) {
          queue.push(injector);
        }
      }
    }
    return owners;
  }

  /**
   * The late classes reachable from a pure class.
   */
  protected closureOf(owner: Service, late: Set<Service>): Service[] {
    const closure: Service[] = [];
    for (const service of late) {
      if (this.ownersOf(service, new Set([owner]), late).has(owner)) {
        closure.push(service);
      }
    }
    return closure;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * A class's name in the build list (#Q3401): `module.name:ClassName`, or
   * the class name alone when no module lists it. Computed the same way on
   * the build's container and on the runtime's, so the two agree on a class
   * without sharing a reference.
   */
  public static keyOf(service: Service): string {
    const module = (service as { [MODULE]?: { name?: string } })[MODULE];
    return module?.name ? `${module.name}:${service.name}` : service.name;
  }

  /**
   * The side a primitive kind declares, `boot` when it declares none.
   */
  public static sideOf(kind: Service<Primitive>): PrimitiveSide {
    return (kind as unknown as { side?: PrimitiveSide }).side ?? "boot";
  }

  /**
   * `$action` for `ActionPrimitive`, as an author writes it.
   */
  public static kindName(kind: Service<Primitive>): string {
    const name = kind.name.replace(/Primitive$/, "");
    return `$${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  }
}
