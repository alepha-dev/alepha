import type { Atom, Infer, ZType } from "alepha";

/**
 * Recursive readonly reducer input; runtime providers also freeze the snapshot.
 */
export type ActorReadonly<T> = T extends object
  ? { readonly [K in keyof T]: ActorReadonly<T[K]> }
  : T;

/**
 * Pure synchronous reducers returning complete, schema-valid JSON state.
 * Redis may rerun reducers on definite conflicts. Arguments must also be JSON.
 */
export type ActorMethods<T> = Record<
  string,
  (state: ActorReadonly<T>, ...args: any[]) => T
>;

export interface ActorDeclaration<T extends ZType = ZType> {
  atom: Atom<T, string>;
  methods: ActorMethods<Infer<T>>;
}

export interface ActorRequest {
  name: string;
  key?: string;
  method?: string;
  args: unknown[];
}

export interface ActorEnvelope {
  version: 1;
  revision: number;
  state: unknown;
}

/**
 * Typed asynchronous calls resolving to this invocation's committed snapshot.
 */
export type ActorCalls<T, M extends ActorMethods<T>> = {
  [K in keyof M]: M[K] extends (state: any, ...args: infer A) => any
    ? (...args: A) => Promise<T>
    : never;
};

/**
 * Default or keyed actor identity, independent from the ordinary atom store.
 * Reads observe detached state; get selects a key synchronously without I/O.
 */
export type ActorHandle<T, M extends ActorMethods<T>> = ActorCalls<T, M> & {
  read(): Promise<T>;
  get(key: string): ActorHandle<T, M>;
};
