import { $module } from "alepha";

export * from "./render.ts";

/**
 * Write notification and transactional emails as React components.
 *
 * `render()` turns a component into the `(variables) => Promise<string>` that
 * `$notification`'s `body` and `$email.send()` both already accept, so a
 * template becomes a component and nothing else in the stack changes.
 *
 * ```tsx
 * const WelcomeEmail = (props: { name: string }) => (
 *   <html lang="en">
 *     <body>
 *       <h1>Welcome, {props.name}</h1>
 *     </body>
 *   </html>
 * );
 *
 * class Templates {
 *   welcome = $notification({
 *     schema: z.object({ name: z.text() }),
 *     email: { subject: "Welcome", body: render(WelcomeEmail) },
 *   });
 * }
 * ```
 *
 * **Components come from elsewhere.** This module renders; it ships no
 * components of its own. `@react-email/components` is the recommended
 * companion (Outlook-safe tables, `<Tailwind>`, `<Button>` with VML
 * fallbacks) and renders through this unchanged. Install it in the app, not
 * in the framework.
 *
 * ⚠️ **`@react-email/render` is deliberately NOT used.** Measured on
 * 2026-08-27, bundled for workerd: 976 KB raw / 301 KB gzip, and importing
 * only `render` changes nothing, because `prettier/standalone` and
 * `prettier/plugins/html` are static top-level imports that do not
 * tree-shake. That is +134 KB gzip over `react-dom/server.edge` for a
 * formatter no production send calls.
 *
 * **A template gets props, not the container.** No `useI18n()` or
 * `useInject()` inside an email component: everything arrives as props. The
 * renderer runs inside a job with no request context, and driving a
 * recipient's language into the i18n store for the duration of a render is
 * the shape of bug the notification layer already warns about. Templates
 * keep using `$notification`'s own `translations` map.
 *
 * **Plain text is not this module's job.** `render()` returns HTML; the
 * notification sender derives the text part with `EmailTextRenderer` from
 * `alepha/email`, or uses the `text` the template declared.
 *
 * @module alepha.react.email
 */
export const AlephaReactEmail = $module({
  name: "alepha.react.email",
  services: [],
});
