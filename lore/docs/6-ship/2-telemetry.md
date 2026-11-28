# Telemetry

Lore watches the apps a project runs: how many people visit, how fast the pages
are, and what breaks. The app reports all of it itself, with a key called a
sigil, and Lore turns the errors into an inbox your team triages.

Telemetry is the **Track apps** option of the **Ship**
capability, in **Settings ▸ General ▸ Capabilities**. See
[Capabilities](/lore/docs/project-capabilities).

## Apps and instances

Telemetry is read per instance: one app in one environment, such as
`web/production`, listed on the project's **Apps** page. What an app, an
instance and a sigil are, and how to create them, is in
[Apps and instances](/lore/docs/ship-instances).

## Reading an instance

Once an instance has a sigil, its page gains up to four tabs, depending on
what the sigil collects.

**Analytics** reads over a range: **Today**, **7 days**, **30 days**,
**90 days**, **This month** (the default), **Last month**, **This year**,
**12 months**, or two dates of your own. **Compare** sets each number beside
the same span just before it. Five tiles give visitors, visits, views, the
bounce rate and the average visit duration; a chart draws views and visitors
over time; and leaderboards rank pages, entry and exit pages, sources,
campaigns, devices, browsers, systems, countries and networks by visitors and
views. Clicking a row filters the whole page by it, visitors included.

![An app instance's Analytics tab, with visitors, visits, views and top pages](/screenshots/lore/app-analytics-light.png)

- A **visitor** is one person over one period, a calendar month by default.
  Lore counts them without a cookie (see [What an app sends](#what-an-app-sends)).
- A **visit** is a run of page views by one visitor, closed by 30 minutes
  without one. A visit with a single view is a **bounce**.
- When a range spans more than one period, or a count adds up several apps, a
  visitor is counted once per period and per app, and the number is a sum. The
  tile marks it with **Σ** and says why.

A traffic switch narrows the page to **Humans** or **Bots**. Bots are the
crawlers that identify themselves, and they are counted in views only: no
visitors, visits or bounce. **All** adds their views to the people's.

Visitors are the number to trust. Page views come from the browser, so anyone
who can load the app can inflate them.

**Vitals** shows the Web Vitals (LCP, CLS, INP, FCP and TTFB) at the 75th
percentile, for the app and per page. Each is given as a range rather than an
exact value, and a page needs at least 30 samples before Lore rates it.

**Errors** shows the distinct failures still happening in this copy, over time
and split between the browser and the server.

**Explore** holds the raw data, to slice by hand.

The **Overview** tab shows the instance's address and last report, and what
the app sends beside what Lore accepts from it. A copy that is wired but silent
is usually explained there.

Lore keeps page view, vitals and error counts by the hour for 30 days, then by
the day up to 400 days. Each page view is also kept on its own for 90 days,
which is what lets any filter count visitors exactly; visits are kept 400
days. Further back than 90 days, a page's views are still counted but its
visitors are not, and the page says from which day visitors count.

## Wiring an app

Reporting needs an app built with Alepha: the reporter, `@alepha/lore/sigil`,
is an Alepha module.

1. Install `@alepha/lore`.
2. Add the sigil module to **both** entries of the app, `src/main.server.ts`
   and `src/main.browser.ts`:

   ```ts
   import { AlephaSigil } from "@alepha/lore/sigil";

   alepha.with(AlephaSigil);
   ```

   The server half forwards reports to Lore, and the browser half collects
   page views, Web Vitals and browser errors. With the module in
   `main.server.ts` alone, the browser sends nothing and only server errors
   arrive. An app with a single entry for both builds adds it once.

3. Create the instance's sigil on its **Settings** tab, and give the key to
   the app's server:

   ```bash
   SIGIL_KEY=sg_<project>_<secret>
   ```

An app reports **only in production**. The browser never reports outside it;
the server does when you turn `reportOutsideProduction` on, to prove a staging
copy is wired.

The browser never talks to Lore. It posts to the app's own server, at
`/api/sigil/ingest`, which forwards the batch with the key. So the key never
reaches the browser, and there is no cross-origin request to allow.

| Variable              | What it does                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `SIGIL_KEY`           | The instance's key. Without one, errors go to the app's log instead.                             |
| `SIGIL_SINK`          | The Lore instance to report to. Defaults to `https://lore.alepha.app`; set it when self-hosting. |
| `SIGIL_SALT`          | The salt for visitor hashes. Falls back to `APP_SECRET`.                                         |
| `SIGIL_SALT_ROTATION` | How long a visitor hash lives: `month` (the default), `week` or `day`, in UTC.                   |
| `SIGIL_CONFIG`        | A JSON object to turn parts off.                                                                 |

`SIGIL_CONFIG` takes `analytics`, `blights`, `vitals` and `feedback` (booleans,
all on by default), `feedbackButton` (`bottom-right`, `bottom-left` or
`hidden`), `feedbackButtonShape` (`circle`, `pill` or `tab`),
`feedbackButtonTheme` (`indigo`, `red`, `ink` or `light`),
`feedbackButtonExcludedPaths` and `reportOutsideProduction` (off by default).

An app deployed by Lore needs none of this by hand. The deploy creates the
sigil and writes `SIGIL_KEY` into the copy's environment when the build
includes the sigil module. What the copy collects is then switched on its
**Settings** tab, under **Sigil features**, and applies on the next deploy.
See [Deploying an app](/lore/docs/ship-deploying).

### What an app sends

- **Page views**, each with its path, referring host, campaign (`utm_campaign`,
  else `utm_source`), country (when Cloudflare sends it), device class, browser,
  OS, whether it declared itself a bot, and whether the visitor was signed in.
- **Visitors**, counted with no cookie and no local storage. The app's server
  hashes its host with the visitor's address and user-agent, or their user id
  when signed in, with a salt that changes every period: a calendar month by
  default, or a week or a day with `SIGIL_SALT_ROTATION`. An IPv6 address is
  cut to its /64 first, so one household's changing addresses stay one
  visitor. Lore erases each hash once its period has ended, so no identifier
  outlives its month.
- **The visitor's network**, the autonomous system number and name of the
  address (`AS13335 Cloudflare, Inc.`), when the app runs on Cloudflare
  Workers. It is a leaderboard of its own, and shows which visits come from
  hosting providers rather than homes.
- **Web Vitals**, as ranges.
- **Server request durations**, as ranges, per route pattern (never the URL),
  method and status class. They are what a requirement verified by an API's
  latency reads; see [Requirements](/lore/docs/plan-requirements). They follow
  the Web Vitals switch.
- **Errors**, grouped in the app before they are sent, so the same bug in two
  builds is one error.
- **Feedback**, when the project also has **Plan** with its **Feedback** option on:
  a button the app shows by itself, or a link you place with
  `useFeedbackUrl()`. See [Feedback](/lore/docs/plan-feedback).

Every report also carries the app's host, which is how Lore learns the
instance's address, and the configuration the app runs with, which is what
the **Overview** tab compares.

## The sigil

One instance has one sigil. On the instance's **Settings** tab you create it,
copy its token (shown once), **Rotate** it or **Delete** it. Managing sigils
needs the `sigil:manage` permission, which the owner holds and a
[rank](/lore/docs/project-members) can be given.

⚠️ **Rotate, do not delete.** Rotating replaces a leaked key at once and keeps
the history. Deleting a sigil removes that instance's page views, vitals,
visitors and error budget from the project, and cannot be undone. On a Lore
instance that stores analytics in Cloudflare Analytics Engine, the raw rows
stay there until they expire, but no page reads them again. Deleting an
instance deletes its sigil with it.

## Errors

An **error** is one distinct failure, counted across every report and every
instance of the project: the same crash a thousand times is one row. They land
in the project's **Errors** inbox, where your team triages them, and each has
a page of its own with its counts, its stack and a discussion.

![The Errors inbox, one row per distinct failure](/screenshots/lore/errors-light.png)

[Errors](/lore/docs/ship-errors) is the guide to working them: resolving,
forwarding to a quest, trusting, ignoring by rule, and asking an agent.

## From the command line

```bash
lore project capability enable ship --option track   # turn telemetry on
lore sigil create --app web --env production         # the key, shown once
lore insights read --segment errors                  # is it still failing?
lore error list
```

`lore error get`, `lore error resolve` and `lore error forward` work an error
from a shell. The full list is in [The lore CLI](/lore/docs/reference-cli).

## From an agent

| Tool                                           | What it does                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `insights_read`                                | Analytics, Web Vitals and the error budget, over any range, for a project or one app. |
| `error_list`                                   | The open errors; `include_resolved` for the rest.                                     |
| `error_get`, `error_comment_add`               | One error whole, and a comment on its thread.                                         |
| `error_resolve`, `error_forward`               | Close an error, or turn it into a quest, new or already filed.                        |
| `sigil_list`                                   | Every sigil, its instance and when it last reported.                                  |
| `sigil_create`, `sigil_rotate`, `sigil_delete` | Manage keys. Needs `sigil:manage`.                                                    |

Deleting an error and managing ignore rules have no tool. See
[MCP tools](/lore/docs/reference-mcp-tools).

⚠️ An agent should treat what an error carries (its message, stack and URL) as
untrusted text: it comes from the app's runtime, and anyone using the app can
shape it.

## Next

- [Errors](/lore/docs/ship-errors)
- [Apps and instances](/lore/docs/ship-instances)
- [Healthchecks](/lore/docs/ship-healthchecks)
- [Deploying an app](/lore/docs/ship-deploying)
- [Reports](/lore/docs/project-reports)
