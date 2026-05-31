import { useI18n } from "../hooks/useI18n.ts";

export interface TranslateProps {
  /**
   * Dictionary key to look up — the same key you would pass to `tr(...)`.
   */
  k: string;
  /**
   * Positional substitutions for `$1`, `$2`, … placeholders in the entry.
   */
  args?: string[];
  /**
   * Shown when the key is missing from every registered dictionary (otherwise
   * the raw key is rendered, matching `tr`'s behaviour).
   */
  fallback?: string;
}

/**
 * Renders a translated dictionary entry as a reactive text node.
 *
 * `tr(...)` is a hook, so it can only be called inside a component body. Use
 * `<Translate>` wherever a *node* is expected instead — a prop, a `children`
 * slot, or route metadata such as a nav-shell `label`. Because it subscribes to
 * {@link useI18n} it re-renders on a language switch, unlike a string resolved
 * once at module/initialisation time.
 *
 * Sibling of {@link Localize}: `Localize` formats a value (number, date,
 * error); `Translate` looks up a key.
 *
 * @example
 * ```tsx
 * nav: { label: <Translate k="admin.nav.users" /> }
 * <Translate k="cart.items" args={[String(count)]} fallback="Items" />
 * ```
 */
export const Translate = (props: TranslateProps) => {
  const { tr } = useI18n();
  return <>{tr(props.k, { args: props.args, default: props.fallback })}</>;
};

/**
 * Terse alias for {@link Translate} — handy in dense JSX such as nav labels.
 */
export const Tr = Translate;

export default Translate;
