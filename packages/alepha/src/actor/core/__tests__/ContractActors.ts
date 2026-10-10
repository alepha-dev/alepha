import { $atom, AlephaError, z } from "alepha";
import { $actor } from "alepha/actor";

/**
 * Identical reducer declarations for every provider and the packed consumer.
 */
export class ContractActors {
  public static readonly counterAtom = $atom({
    name: "contract.counter",
    schema: z.integer(),
    default: 0,
  });
  public counter = $actor({
    atom: ContractActors.counterAtom,
    methods: {
      add: (state, amount: number = 1) => state + amount,
      invalid: () => 0.5,
      fail: () => {
        throw new AlephaError("refused");
      },
      promise: () => Promise.resolve(1) as any,
    },
  });
  public session = $actor({
    atom: $atom({
      name: "contract.session",
      schema: z.object({
        names: z.array(z.text()),
        nested: z.object({ count: z.integer() }),
      }),
      default: { names: [], nested: { count: 0 } },
    }),
    methods: {
      append: (state, input: { name: string }) => ({
        names: [...state.names, input.name],
        nested: { count: state.nested.count + 1 },
      }),
      mutate: (state) => {
        (state.names as any).push("forbidden");
        return state as any;
      },
      undefinedResult: () =>
        ({ names: [undefined], nested: { count: 0 } }) as any,
    },
  });
  public collisionA = $actor({
    atom: $atom({ name: "contract:actor:b", schema: z.integer(), default: 0 }),
    methods: { add: (state, n: number) => state + n },
  });
  public collisionB = $actor({
    atom: $atom({ name: "contract:actor", schema: z.integer(), default: 0 }),
    methods: { add: (state, n: number) => state + n },
  });
  public namespaceCollision = $actor({
    atom: $atom({ name: "actor:b", schema: z.integer(), default: 0 }),
    methods: { add: (state, n: number) => state + n },
  });
  public corrupt = $actor({
    atom: $atom({ name: "contract.corrupt", schema: z.integer(), default: 0 }),
    methods: { add: (state) => state + 1 },
  });
  public byName(name: string): any {
    for (const actor of [
      this.counter,
      this.session,
      this.collisionA,
      this.collisionB,
      this.namespaceCollision,
      this.corrupt,
    ])
      if (actor.options.atom.key === name) return actor;
    throw new AlephaError(`Unknown fixture actor '${name}'`);
  }
}
