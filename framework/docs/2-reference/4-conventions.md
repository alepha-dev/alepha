# Conventions

The rules `alepha check` enforces, as this version ships them. `alepha verify` runs the command between lint and typecheck. The [Conventions guide](/docs/guides-testing-conventions) explains why each rule exists, how to exempt a line and how to configure the command.

| Rule               | Default | Refuses                                                                         | Write instead                                                                                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-date-now`      | on      | Date.now() cannot be travelled in a test.                                       | Inject DateTimeProvider and call this.dateTime.nowMillis() (or now()), so a test can travel(). In a component, useInject(DateTimeProvider). |
| `no-bare-error`    | on      | A bare Error has no name a caller can catch by type.                            | Throw AlephaError from "alepha", or declare an $error when a caller can act on it.                                                          |
| `no-error-class`   | on      | An error class is invisible to the registry the browser rebuilds errors from.   | Declare it with $error({ name, schema }), or derive one with Parent.extend({ name }).                                                       |
| `no-zod-import`    | on      | A second copy of zod is not type-compatible with the framework's z.             | Import z from "alepha": it carries the framework's defaults and extensions.                                                                 |
| `no-vi-mock`       | on      | A vi mock replaces a module, a method or the clock behind the container's back. | Substitute the service: Alepha.create().with({ provide: X, use: MemoryX }). For time, alepha.inject(DateTimeProvider).travel().             |
| `describe-it`      | on      | A test case outside any describe().                                             | Wrap the cases in describe("&lt;unit>", () => { ... }) and write each one as it().                                                          |
| `no-module-code`   | on      | Code outside the class cannot be substituted through the container.             | Move it onto the class as a protected member, so a test or a subclass can replace it.                                                       |
| `no-window-dialog` | on      | A browser dialog blocks the page and cannot be styled or tested.                | const dialog = useDialog() from @alepha/ui, then await dialog.confirm({ title }) (or dialog.alert, dialog.prompt).                          |

A line that is a genuine exception carries `// alepha-allow <rule>: <reason>` on the line above it. The reason is mandatory.
