# Quality

Quality is what your tests say about the code: coverage and test counts,
pushed by CI after each run, kept per branch, and drawn over time. It is a
tab of Reports: turn on Reports' **Quality** option in
**Settings ▸ General ▸ Capabilities**.
See [Capabilities](/lore/docs/project-capabilities).

## Pushing a run

Quality shows only what a pipeline sends. After the tests, one command sends
the run of the current checkout:

```bash
lore quality push
```

It reads `coverage/coverage-summary.json` and `coverage/test-results.json`,
the two files `alepha test --coverage` writes, and files the run under the
checked-out branch; `--branch` names another. In CI, set `LORE_API_KEY` to an
API key of the project. Lore keeps one run per branch and per day.

## The Quality report

Open **Reports ▸ Quality**, and pick the branch whose runs it shows.

- **Coverage**: lines, statements, functions and branches of the latest run,
  against the target when one is set.
- **Tests**: total, passed, failed and the run's duration.
- **Coverage over time** and **Tests over time**: one point per run.
- **Test duration**: how long the suite takes, run after run.
- **Coverage by release tag**: the coverage of the run whose commit each
  release artifact was built from.

Until a run arrives, the report says how to push one.

## A coverage target

Set the target on **Settings ▸ General ▸ Quality**, under **Coverage target (%)**. The
report draws it, and Lore tells you once when a push on `main` reports
coverage under it, then again only after coverage has come back above it.
Who is told is set on **Settings ▸ Notifications**. See
[Notifications](/lore/docs/project-notifications).

## On the dashboard

The **Coverage** card shows line coverage over the recorded runs, and the
**Code quality** preset puts coverage over time, the latest coverage and the
failing tests on one dashboard. See [Dashboard](/lore/docs/project-dashboard).

## From the command line

| Command                       | What it does                                      |
| ----------------------------- | ------------------------------------------------- |
| `lore quality push`           | Send the coverage and test totals of the last run |
| `lore threshold get`          | The coverage and open-errors alert thresholds     |
| `lore threshold set`          | Set or clear a threshold (`--coverage-min`)       |
| `lore project report quality` | The Quality report's figures, for a period        |

The full list is in [The lore CLI](/lore/docs/reference-cli#quality).
