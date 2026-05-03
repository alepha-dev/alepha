# DateTime — Refactoring Roadmap

## Context

Step 1 (done) isolated dayjs behind two wrapper classes — `DateTime` and `Duration` — exposed by `DateTimeProvider`. Nothing in the codebase imports dayjs directly anymore; only this module does.

Step 2 (this document) is the engine swap: replace the dayjs internals of those wrappers with `Temporal` + `Intl`, then remove dayjs entirely. **Public API stays identical**, so call-sites across the framework do not change.

This refactoring is **deferred** until `Temporal` is natively available across our supported runtimes (Node, Bun, modern browsers). Today (2026-05) only Firefox ships it stably; V8/JSC are still flagged. Pulling the trigger before then would force every consumer to ship a ~28 KB polyfill — a regression vs the current dayjs footprint.

When the time comes, the migration is contained to **two files** (`DateTimeProvider.ts` and `react/i18n/providers/I18nProvider.ts`) plus `package.json`.

## Polyfill policy

`alepha` will **not** bundle or depend on a Temporal polyfill. Apps that need to support runtimes without native Temporal install one themselves and load it once at startup:

```ts
// app entry point
import "temporal-polyfill/global";
```

Rationale:
- Polyfill choice is an app concern (bundle size, runtime targets).
- The polyfill is global-only by nature; importing it from a library would force it on every consumer regardless of need.
- Once native support is universal, the polyfill becomes a no-op and apps drop the import. `alepha` itself never had to change.

The framework's documentation should mention the polyfill recommendation in the upgrade notes for the release that performs the swap.

## Wrappers — what changes inside

### `DateTime`

Currently wraps `Dayjs`. After the swap it wraps a `Temporal.Instant` (and an optional timezone string for the `tz()` chain). Per-method translation:

| Method | Temporal mapping |
|---|---|
| `add(n, unit)` / `add(Duration)` | `instant.add(Temporal.Duration.from({ [unit]: n }))` |
| `subtract(n, unit)` / `subtract(Duration)` | `instant.subtract(...)` |
| `startOf(unit)` / `endOf(unit)` | Convert to `ZonedDateTime`, zero out lower fields, convert back. ~10 lines per unit. No native equivalent. |
| `isAfter` / `isBefore` / `isSame` | `Temporal.Instant.compare(a, b)` |
| `diff(other, unit?)` | `instant.since(other).total({ unit })` (default unit: `"milliseconds"`) |
| `tz(zone)` | Store `zone` on the wrapper; convert via `instant.toZonedDateTimeISO(zone)` when needed for formatting/`startOf`. |
| `locale(lang)` | Store `lang` on the wrapper (consumed only by `format`/`fromNow`). Or drop the chained form and pass `lang` directly. |
| `format(template?)` | See **Format tokens** below. |
| `fromNow(withoutSuffix?)` | `Intl.RelativeTimeFormat` — pick the largest non-zero unit from `since(now)`. ~25 lines. Needs `lang` (currently inherited from `.locale()` chain). |
| `toISOString()` | `instant.toString()` |
| `toDate()` | `new Date(instant.epochMilliseconds)` |
| `valueOf()` | `instant.epochMilliseconds` |
| `unix()` | `Math.floor(instant.epochMilliseconds / 1000)` |
| `toJSON` / `toString` | same as `toISOString()` |
| `toDayjs()` | **Removed.** Verify with grep first — currently used only inside `DateTimeProvider`. |

### `Duration`

Currently wraps `dayjsDuration.Duration`. After the swap it wraps `Temporal.Duration`. Per-method translation:

| Method | Temporal mapping |
|---|---|
| `asMilliseconds()` etc. | `duration.total({ unit: "milliseconds" })` etc. |
| `as(unit)` | `duration.total({ unit })` |
| `toISOString()` | `duration.toString()` (Temporal already emits ISO 8601) |
| `toDayjs()` | **Removed.** |

Constructor input normalization (number, `[n, unit]` tuple, ISO string `"PT5M"`, existing `Duration`) stays in `DateTimeProvider.duration()`. Temporal parses ISO strings natively via `Temporal.Duration.from()`; the tuple form needs a 3-line shim.

## Format tokens — the one open decision

`DateTime.format(template)` currently delegates to dayjs and supports two flavours:

1. **Localized presets** — `"L"`, `"LL"`, `"LLL"`, `"lll"`, etc. (from `dayjs/plugin/localizedFormat`).
2. **Token strings** — `"YYYY-MM-DD HH:mm:ss"`.

`Intl.DateTimeFormat` uses option objects, not tokens. Two paths:

**(a) Drop tokens — preferred.** Force callers to use `Intl.DateTimeFormat` options. `I18nProvider.l` already supports this path (`options.date` accepts an `Intl.DateTimeFormatOptions` object). The token-string path becomes the fallback to remove. Audit before removal — current callers of `format(token)`:

- `react/i18n/providers/I18nProvider.ts` — `dt.locale(lang).format(options.date)` when `options.date` is a string
- `scheduler/providers/WorkerdCronProvider.ts` — `now.format()` (no template — equivalent to ISO string)

If those are the only callers, deletion is a 5-line change.

**(b) Token mapper.** Keep tokens, write a small dayjs-token → `Intl.DateTimeFormat` translator (~80 lines for `YYYY/MM/DD/HH/mm/ss/L/LL/LLL/lll`). Higher maintenance cost, no real ergonomic win. Recommend against unless external consumers depend on the token form.

## I18n provider changes

`react/i18n/providers/I18nProvider.ts` is the only file outside `datetime/` that exercises the soon-to-change parts of the API:

- `dt.tz(timezone)` — unchanged signature, unchanged caller code.
- `dt.locale(lang).fromNow()` — becomes `dt.fromNow(lang)` (or `relativeFormat(dt, lang)` helper). Caller updated.
- `dt.locale(lang).format(token)` — covered by the format-token decision above.
- The `Intl.DateTimeFormat`/`Intl.NumberFormat` paths in this file already work and are unaffected.

## Test surface

- `datetime/__tests__/DateTimeProvider.spec.ts` — exercises `pause`/`travel`/`createTimeout`/`wait`/`deadline`/`duration`/`isDurationLike`. All operate on epoch-ms internals; should pass unchanged.
- All ~3400 other tests across the framework hit the wrappers via the public API. They are the safety net.

## Removal checklist

When Step 2 ships:

1. `package.json` — remove `dayjs`. No new dep added (polyfill is app-side).
2. `DateTimeProvider.ts` — remove all `dayjs/*` imports, the `PLUGINS` static, the `for (plugin of PLUGINS) DayjsApi.extend(plugin)` constructor block, and the `unwrap`/`toDayjs` helpers.
3. `DateTime.toDayjs()` and `Duration.toDayjs()` — delete.
4. Re-exported dayjs unit types (`ManipulateType`, `OpUnitType`, `QUnitType`, `DurationUnitType`) — replace with locally-defined union types covering the units we actually use. Keep the names if they're referenced externally; just stop sourcing them from dayjs.
5. `react/i18n/providers/I18nProvider.ts` — adjust per the I18n section above.
6. Verify: `grep -r dayjs packages apps` returns nothing.
7. Run `yarn lint && yarn typecheck && yarn test`.

## Why not now

- Polyfill weight: temporal-polyfill ~28 KB gz vs current dayjs+plugins+locales ~15–20 KB gz. Net regression until native lands.
- No functional gain for users today — same behaviour, same wire format (ISO 8601 strings via `t.datetime()`), same testing affordances (`pause`/`travel`).
- The cost of waiting is zero: Step 1 already gave us the abstraction. The engine swap is mechanical when the time is right.

## Estimated effort when triggered

~1 focused day. The wrapper rewrite is mechanical, the I18n adjustment is small, and the test suite catches regressions immediately.
