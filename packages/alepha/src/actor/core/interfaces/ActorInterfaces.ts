import type { Atom, Infer, ZType } from "alepha";

export type ActorReadonly<T> = T extends object
  ? { readonly [K in keyof T]: ActorReadonly<T[K]> }
  : T;

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

export type ActorCalls<T, M extends ActorMethods<T>> = {
  [K in keyof M]: M[K] extends (state: any, ...args: infer A) => any
    ? (...args: A) => Promise<T>
    : never;
};

export type ActorHandle<T, M extends ActorMethods<T>> = ActorCalls<T, M> & {
  read(): Promise<T>;
  get(key: string): ActorHandle<T, M>;
};
