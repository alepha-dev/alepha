// Stands in for a built `index.bun.js`: the app import, then statements the
// wrapper appends (SSR manifest, embedded public files) that must run before
// the app starts.
export * from "./app.ts";

(globalThis as any).__fixtureWrapperDone = true;
