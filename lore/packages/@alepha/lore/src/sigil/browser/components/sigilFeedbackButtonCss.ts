/**
 * The feedback button's whole stylesheet, rendered by the button itself in a
 * `<style>` element.
 *
 * ## Why a stylesheet at all
 *
 * The button used to be styled inline, which needs nothing from the host and
 * cannot express `:hover`, `:focus-visible` or a media query. A control with no
 * hover and no visible focus is what made it read as a sticker on the page
 * rather than as a button. This keeps the property that mattered, no stylesheet
 * for the host app to import, and gets the states.
 *
 * ## Why it is a constant
 *
 * Nothing from the app's config is ever interpolated into it. The shape, the
 * theme and the side arrive as `data-*` attributes holding values already
 * narrowed to a known list, and every rule below is selected by them. A config
 * value therefore cannot write CSS on a third-party page, whatever it holds.
 *
 * ## Selectors
 *
 * Everything hangs off `.alepha-sigil-fb` / `.alepha-sigil-fb-thanks` with an
 * element and an attribute in the selector, which outranks a host's element
 * resets (`button { ... }`) without resorting to `!important`.
 */
export const SIGIL_FEEDBACK_BUTTON_CSS = `
button.alepha-sigil-fb[data-shape] {
  --fb-bg: #4f46e5;
  --fb-hover: #4338ca;
  --fb-fg: #ffffff;
  --fb-ring: rgba(79, 70, 229, 0.45);
  --fb-edge: rgba(255, 255, 255, 0.18);
  position: fixed;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  box-sizing: border-box;
  margin: 0;
  border: 0;
  cursor: pointer;
  background: var(--fb-bg);
  color: var(--fb-fg);
  font: 500 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.01em;
  text-transform: none;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  box-shadow:
    inset 0 0 0 1px var(--fb-edge),
    0 1px 2px rgba(0, 0, 0, 0.1),
    0 6px 16px -4px rgba(0, 0, 0, 0.22);
  transition:
    background-color 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;
}
button.alepha-sigil-fb[data-shape]:hover {
  background: var(--fb-hover);
  transform: translateY(-1px);
  box-shadow:
    inset 0 0 0 1px var(--fb-edge),
    0 2px 4px rgba(0, 0, 0, 0.1),
    0 10px 22px -6px rgba(0, 0, 0, 0.28);
}
button.alepha-sigil-fb[data-shape]:active {
  transform: scale(0.97);
}
button.alepha-sigil-fb[data-shape]:focus-visible {
  outline: 2px solid var(--fb-ring);
  outline-offset: 2px;
}
button.alepha-sigil-fb[data-shape] svg {
  flex: none;
  width: 16px;
  height: 16px;
}

button.alepha-sigil-fb[data-theme="red"] {
  --fb-bg: #dc2626;
  --fb-hover: #b91c1c;
  --fb-ring: rgba(220, 38, 38, 0.45);
}
button.alepha-sigil-fb[data-theme="ink"] {
  --fb-bg: #18181b;
  --fb-hover: #27272a;
  --fb-ring: rgba(113, 113, 122, 0.6);
  --fb-edge: rgba(255, 255, 255, 0.14);
}
button.alepha-sigil-fb[data-theme="light"] {
  --fb-bg: #ffffff;
  --fb-hover: #f4f4f5;
  --fb-fg: #18181b;
  --fb-ring: rgba(113, 113, 122, 0.5);
  --fb-edge: rgba(0, 0, 0, 0.12);
}

button.alepha-sigil-fb[data-shape="circle"],
button.alepha-sigil-fb[data-shape="pill"] {
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}
button.alepha-sigil-fb[data-shape="circle"] {
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: 9999px;
}
button.alepha-sigil-fb[data-shape="circle"] svg {
  width: 18px;
  height: 18px;
}
button.alepha-sigil-fb[data-shape="pill"] {
  height: 34px;
  padding: 0 13px 0 11px;
  border-radius: 9px;
}
button.alepha-sigil-fb[data-shape="tab"] {
  top: 50%;
  padding: 12px 7px;
  font-size: 12px;
  writing-mode: vertical-rl;
  transform: translateY(-50%);
}
button.alepha-sigil-fb[data-shape="tab"]:hover,
button.alepha-sigil-fb[data-shape="tab"]:active {
  transform: translateY(-50%);
}

button.alepha-sigil-fb[data-side="right"] {
  right: calc(16px + env(safe-area-inset-right, 0px));
}
button.alepha-sigil-fb[data-side="left"] {
  left: calc(16px + env(safe-area-inset-left, 0px));
}
button.alepha-sigil-fb[data-shape="tab"][data-side="right"] {
  right: 0;
  border-radius: 8px 0 0 8px;
}
button.alepha-sigil-fb[data-shape="tab"][data-side="left"] {
  left: 0;
  border-radius: 8px 0 0 8px;
  transform: translateY(-50%) rotate(180deg);
}

div.alepha-sigil-fb-thanks[data-shape] {
  position: fixed;
  z-index: 2147483000;
  bottom: calc(62px + env(safe-area-inset-bottom, 0px));
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  padding: 8px 12px;
  border-radius: 9px;
  background: #18181b;
  color: #ffffff;
  font: 500 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    0 6px 16px -4px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
div.alepha-sigil-fb-thanks[data-shape="tab"] {
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}
div.alepha-sigil-fb-thanks[data-side="right"] {
  right: calc(16px + env(safe-area-inset-right, 0px));
}
div.alepha-sigil-fb-thanks[data-side="left"] {
  left: calc(16px + env(safe-area-inset-left, 0px));
}

@media (max-width: 480px) {
  button.alepha-sigil-fb[data-shape="pill"] {
    width: 38px;
    height: 38px;
    padding: 0;
    border-radius: 9999px;
  }
  button.alepha-sigil-fb[data-shape="pill"] .alepha-sigil-fb-label {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  button.alepha-sigil-fb[data-shape] {
    transition: none;
  }
}
`;
