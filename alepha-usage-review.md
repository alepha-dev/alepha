  1. Login override footguns — already covered, shipping in 0.20.
  2. Module auto-registration disabled when you define register().
   The docstring says so, but I tripped on it because I wanted to
  add a theme atom and thought that was a minor hook. Ended up
  with zero routes until I added alepha.with(AppRouter) manually.
  Suggest: either keep auto-register and add a beforeRegister /
  extend hook for the side-effect case, or make the gotcha louder
  (log a warning if services is defined but not injected in a
  custom register).
  3. Naming: alepha.with() vs alepha.register(). I wrote
  alepha.register(AppRouter) instinctively; TS errored. with reads
   well in chains but not great when you mean "just register
  this." Not a blocker, just a first-impression hit.
  4. LoginProps not exported from @alepha/ui/auth. Had to use
  ComponentProps<typeof Login>. Trivial fix.
  5. useDialog().prompt() uses submitLabel, useDialog().confirm()
  uses confirmLabel. Inconsistent. Align to one name.
  6. $uiAdmin shellProps has no first-class "logo" / "brand" slot
  for the navbar top. Today you pass navbarHeader: () => <...> and
   the default is a back-arrow which felt wrong for an admin at
  its root. A brand?: ReactNode | { logo, text } field would cover
   the 80% case.
  7. Admin shell collapses the right column badly on narrow
  viewports because there's no content-max-width by default. My
  dashboard's right column squished when the sidebar was expanded.
   The container flag helps but isn't the default — worth
  documenting or defaulting on.
  8. authRouter.login.options requires casting because options is
  typed very loose. With your new .override() API in 0.20, this
  goes away. 👍
  9. No built-in EmptyState or LoadingSkeleton. Every admin-ish
  app needs these; today I'd hand-roll. Candidates for the next
  component wave.
  10. No PageHeader component. I rewrote the same "eyebrow + title
   + subtitle + right-side actions" block in 4 pages. Screaming
  for a <PageHeader eyebrow=... title=... subtitle=...
  actions={[...]} />. This alone would save a lot of code in every
   admin screen.
