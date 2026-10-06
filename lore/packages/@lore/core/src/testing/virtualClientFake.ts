/**
 * Wrap a hand-written fake of `useClient<Controller>()` so every action on it
 * carries `can()`.
 *
 * A browser spec substitutes `LinkProvider` and returns a plain object of the
 * two or three actions the subject under test calls. The real virtual client
 * is not that: it answers for EVERY action on the controller, and each of
 * those answers is a function carrying `can()` beside it. Since epic #E39
 * components read `can()` on actions they never call - a Save button asks
 * about `updateQuestById` on first render, whether or not anything is saved -
 * so a fixed map fails with `x.can is not a function`, or worse
 * `Cannot read properties of undefined`, for a reason the spec is not about.
 *
 * The Proxy answers the missing names with a no-op action, so a fake stays
 * the size of what the spec actually asserts on.
 *
 * ⚠️ `can()` answers **true** here. These specs assert rendering and wiring;
 * what a rank hides is asserted where the permission set is the subject
 * (`useRank.browser.spec.tsx`, `projectWriteControls.browser.spec.tsx`), by
 * putting a real set in `currentProjectAtom` and letting `ProjectScopeGrants`
 * narrow. Pass `can: false` for the read-only half of a spec that wants both.
 */
export const virtualClientFake = <T extends Record<string, unknown>>(
  actions: T,
  options: { can?: boolean } = {},
): T => {
  const allowed = options.can ?? true;

  const decorate = (value: unknown): unknown => {
    if (typeof value !== "function") return value;
    const fn = value as ((...args: unknown[]) => unknown) & {
      can?: () => boolean;
    };
    if (!fn.can) fn.can = () => allowed;
    return fn;
  };

  for (const key of Object.keys(actions)) {
    decorate((actions as Record<string, unknown>)[key]);
  }

  const missing = new Map<string, unknown>();

  return new Proxy(actions, {
    get: (target, prop: string | symbol) => {
      if (typeof prop !== "string") {
        return (target as Record<string | symbol, unknown>)[prop as never];
      }
      const own = (target as Record<string, unknown>)[prop];
      if (own !== undefined) return decorate(own);
      // An action the subject reads but the spec never stubbed. It has to
      // exist and carry `can()`; calling it would be a spec asserting on
      // something it did not set up, so it resolves to nothing.
      if (!missing.has(prop)) {
        const fn: any = async () => undefined;
        fn.can = () => allowed;
        missing.set(prop, fn);
      }
      return missing.get(prop);
    },
  }) as T;
};
