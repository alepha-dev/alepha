# Verify and runs

Lore runs no agent and no test. **Verify** builds the prompt you paste into
an agent, or the command that prints it, and a **run** records what came of
it: one result per acceptance criterion, with its evidence.

Verify and runs are part of the **Requirements** option of the **Plan**
capability. See [Personas](/lore/docs/plan-personas) for turning it on.

## The Verify dialog

**Verify** is the robot button on a use case's page and on a persona's page,
where it lists the missions, and **Verify all stale** on the Use cases tab.
It opens a dialog:

![The Verify dialog](/screenshots/lore/requirements-verify-light.png)

- **Mission**: **Test** (play the criteria and record one run, fixing
  nothing), **Write the e2e test** (an end-to-end spec tagged `@U7`), **Demo** (a
  demo script and its data) or, on a persona, **Explore** (exploratory testing
  in their shoes).
- **App** and **Environment**: the app copy to play on, or `local`.
- **Play as**: the persona whose role the agent takes.

The preview is the prompt itself. **Copy prompt** copies it; **Copy command**
copies the `lore usecase prompt` line that prints the same text.

The prompts are templates the project can edit in **Settings ▸ Agent
prompts**, which lists them whenever the Requirements option is on. Besides
the usual placeholders, they fill `{{steps}}`, `{{criteria}}`, `{{persona}}`,
`{{demoAccount}}`, `{{app}}`, `{{env}}` and `{{appUrl}}`.

## Runs

A run is recorded by an agent, by CI, or by hand. It holds one result per
criterion (**Passed**, **Failed** or **Not run**), who ran it, where and
when. The use case's **Runs** tab lists them, and its last result shows on
the Use cases tab.

A run goes **stale** when a quest of an epic covering the use case
completes after it, or when the scenario changes: run it again. A banner on
the use case says so.

A failed criterion opens an error in the project's
[errors inbox](/lore/docs/ship-errors) once every quest covering the use case
is done, and only when the project has Ship's **Track** option on. While the
quests are open, the failure is **In development** and opens nothing. A
later pass resolves the error.

A failed criterion's note reads best for a person when it uses these
labels, one per line:

```text
Expected: choosing a region narrows every chart.
Seen: only the orders chart narrows.
Also: the region picker offers no store.
Details: page /overview, region north. Repro: Overview, then Region.
```

The Runs tab shows **Expected**, **Seen** and **Also** as rows, and folds
**Details** under them for whoever fixes it. A note without these labels
shows as written. The prompt Lore gives an agent asks for this shape.

### Evidence

Screenshots and recordings are attached to a run, on a criterion or a step,
up to 50 MB a file. They are kept for the current release and the three
before it, and within a release only for the latest run of each use case.
An older run keeps its results and shows "recording no longer kept".

### From Playwright

A project's end-to-end specs can record their runs themselves. Tag a test
with its use case and criterion, and add Lore's reporter:

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [["list"], ["@alepha/lore/playwright"]],
});
```

```ts
test("the discount shows @U7 @C2", async ({ page }) => {
  // ...
});
```

## From the command line

```bash
lore usecase prompt U7 --mode test --app acme --env staging
lore usecase run record U7 --by agent --result "C1=passed,C2=failed:no discount"
lore attachments push --run 41 --criterion C2 screenshot.png
```

See [The lore CLI](/lore/docs/reference-cli).

## From an agent

`usecase_prompt` returns the same prompt as the dialog, and
`usecase_run_record` records a run. An agent following a Test prompt plays
the criteria, records one run, and fixes nothing. `usecase_run_attachment_add`
answers the command that attaches a screenshot to the run, on the criterion it
shows. The full list is in
[MCP tools](/lore/docs/reference-mcp-tools).

## Next

- [Traceability](/lore/docs/plan-traceability): what the runs add up to.
- [Personas](/lore/docs/plan-personas): the showcase of their recordings.
