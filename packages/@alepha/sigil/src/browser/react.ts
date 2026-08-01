/**
 * The React surface of the package: `@alepha/sigil/react`.
 *
 * A subpath of its own, and **condition-free** — `types`, `import`, `default`
 * and `browser` all resolve this same file. That is the whole point. These
 * symbols used to live only behind the `browser` condition, which meant
 * `import { SigilRoot } from "@alepha/sigil"` type-checked as a missing export
 * everywhere except a client bundle, and an SSR host failed on the server pass
 * of the very component it was told to render.
 *
 * It is not folded into the `.` entry either: that entry registers the module
 * and reaches `alepha/server`, so a headless API app imports it with no React
 * in sight. Rendering is opt-in, and paying for React should be too.
 *
 * Nothing here is mounted automatically. `<SigilRoot />` is the
 * batteries-included default; {@link usePetitionUrl} is for a host app that
 * would rather render its own link.
 */
export {
  SigilFeedbackButton,
  type SigilFeedbackButtonProps,
} from "./components/SigilFeedbackButton.tsx";
export { SigilRoot } from "./components/SigilRoot.tsx";
export * from "./usePetitionUrl.ts";
