import { type ComponentType, lazy, Suspense } from "react";

/**
 * A component behind a chunk boundary, for a registry entry (#E75, #Q2624).
 *
 * The shells (`WorkShell`, `KnowledgeShell`, `DeployShell`) are services, so
 * they sit in the eager graph on the server as well as in the browser, and a
 * component they import statically is parsed by every Worker isolate at
 * boot. Registering the components through here kept the eager graph at its
 * pre-registry size: before it, the shells took it from 105 modules (2.2 MB)
 * to 210 (3.0 MB), the dialogs pulling the markdown editor, `@base-ui` and
 * `highlight.js` with them, for +25% import time.
 *
 * The fallback is nothing: every registered part is a dialog that opens on a
 * gesture, a hover card, a tab body or a pane, and each draws its own
 * loading state once its chunk is in.
 */
export const lazyPart = <P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> => {
  const Inner = lazy(load);
  const LazyPart = (props: P) => (
    <Suspense fallback={null}>
      <Inner {...props} />
    </Suspense>
  );
  return LazyPart;
};
