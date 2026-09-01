/**
 * The `triggerClassName` a `<Control>` wears inside a DevTools toolbar.
 *
 * DevTools deliberately runs two visual stacks side by side (see the token
 * block at the top of `main.css`): panels built out of `AutoForm` are shadcn,
 * toolbars are `--dt-*`. A picker in a toolbar sits between a `dt-input`
 * search field and `dt-btn` buttons, so its trigger keeps that skin while
 * `Control` supplies the popup, the search field and the keyboard handling.
 *
 * `.dt-input` is unlayered CSS and Tailwind's utilities are layered, so it
 * wins on every property it declares - height, padding, border, background,
 * colour, font-size. `rounded-none` is here because it declares no
 * border-radius, and the trigger's own `rounded-lg` would otherwise survive.
 *
 * ⚠️ It is `width: 100%`, so the width belongs on a wrapper around the
 * `<Control>` and never on the trigger: the toolbar sizes the slot, the
 * trigger fills it - exactly as when these were `<select className="dt-input">`.
 */
export const DT_TRIGGER = "dt-input rounded-none";
