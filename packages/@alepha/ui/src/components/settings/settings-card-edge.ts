/**
 * The edge every settings card wears: a single 1px border, a 10px radius and
 * the soft drop shadow. Padding is deliberately NOT in here: a row card, a
 * table card and a form card each carry their own, and only the edge has to
 * agree.
 *
 * It is a shared constant because the hand-written version had already drifted
 * four ways across ten call sites: `py-4 shadow`, `py-3 shadow`, bare `shadow`
 * and bare `<Card>`, so a settings page could show two cards side by side with
 * visibly different edges (`/settings/kanban` had a 1px-bordered card directly
 * above a borderless 14px-radius one).
 *
 * ⚠️ **`ring-0` is the load-bearing part.** `Card` draws its own edge with
 * `ring-1 ring-foreground/10` and no border at all. Adding `border` without
 * cancelling that ring does not replace the edge, it stacks a second one
 * outside the first, and the card reads a pixel heavier than everything built
 * the other way. Every historical variant here got that wrong in one direction
 * or the other.
 *
 * `Card` itself cannot carry this: it lives in `components/ui/`, which
 * `yarn w @alepha/ui sync` overwrites wholesale from the upstream registry, so
 * a patch there vanishes on the next refresh.
 */
export const settingsCardEdge = "bg-card rounded-lg border shadow-sm ring-0";
