/**
 * The default templates of Plan's Requirements prompt kinds (#E153),
 * rendered on the server by `RequirementsPromptService` for the Verify
 * dialog, `usecase_prompt` and `lore usecase prompt`, and editable in
 * Settings › Agent prompts. Written for any Lore project, not only an app
 * built with Alepha.
 */
export class RequirementsPromptDefaults {
  public static readonly useCaseTest = `You are testing use case {{reference}}, "{{title}}", of the Lore project {{project}} ({{url}}). Play it; fix nothing.

Where: {{app}} {{env}} {{appUrl}}
As: {{persona}} (demo account: {{demoAccount}}; the password is never in Lore, ask for it)

Scenario:
{{steps}}

Acceptance criteria:
{{criteria}}

1. Play the main flow and every alternative, in each actor's role.
2. For each criterion, decide passed, failed or not_run. A failure's note reads for a person first, one line per label: \`Expected: <what should happen>\`, \`Seen: <what happened>\`, \`Also: <anything else worth knowing>\` if any, then \`Details: <page, state, repro steps, ids>\` for the developer. Lore shows the first three as rows and folds the details.
3. Record ONE run with \`usecase_run_record\` (project_name "{{project}}", number {{number}}, by "agent", your client name, app and env as above, one result per criterion), or \`lore usecase run record {{reference}} --by agent --result C1=passed,C2=failed:why\`.
4. Attach your screenshots or recording to the criterion they show with \`lore attachments push <file> --run <runId> --criterion C2\` (\`usecase_run_attachment_add\` gives you that line).
5. A failure opens an error only once every quest covering the use case is done and the project tracks errors; do not open quests or fix code yourself. Report what failed and where.`;

  public static readonly useCaseSpec = `Write the end-to-end spec of use case {{reference}}, "{{title}}", of the Lore project {{project}} ({{url}}).

Scenario:
{{steps}}

Acceptance criteria:
{{criteria}}

1. Work in a git worktree of your own, on a new branch.
2. Write one test per acceptance criterion, each tagged \`@U{{number}}\` and naming its key (\`C2\`) in its title, so the Lore Playwright reporter (\`@alepha/lore/playwright\`) records the run from CI.
3. Use the persona's demo account ({{demoAccount}}) through the app's own seed; never commit a password.
4. Push, open a pull request, wait for CI, and record the spec's path and tag on the use case with \`usecase_update\` (automatedTestPath, automatedTestTag).`;

  public static readonly personaExplore = `Explore the app as the persona {{reference}}, "{{title}}", of the Lore project {{project}} ({{url}}): {{persona}}.

Where: {{app}} {{env}} {{appUrl}} (demo account: {{demoAccount}}; ask for the password)

Their use cases:
{{steps}}

1. Read the persona with \`persona_get\` (number {{number}}) and its use cases with \`usecase_get\`.
2. Use the app in their shoes for half an hour: the tasks they come for, the way they would do them.
3. List every friction you meet, each cited against a requirement (\`requirement_list\`) where one applies, and comment them on the persona with \`persona_comment_add\`.
4. Change nothing in the code.`;

  public static readonly useCaseDemo = `Prepare a demo of use case {{reference}}, "{{title}}", of the Lore project {{project}} ({{url}}).

Where: {{app}} {{env}} {{appUrl}}
As: {{persona}} (demo account: {{demoAccount}})

Scenario:
{{steps}}

1. Read the use case with \`usecase_get\` (number {{number}}).
2. Write a demo script: what to show, in order, and what to say at each step.
3. List the data the demo needs and how the seed provides it.
4. File the script as a folio with \`folio_create\` (Lore creates none), and link it from the use case with a comment (\`usecase_comment_add\`).`;

  public static readonly requirementImport = `Import the specification {{reference}}, "{{title}}", of the Lore project {{project}} ({{url}}) as requirements.

1. Read the folio with \`folio_get\` (shortId {{number}}).
2. For each requirement it states (a "must", "should" or "can" sentence, a numbered rule), create one with \`requirement_create\`: its statement in one sentence, its type (functional, non_functional, constraint), its MoSCoW priority, its chapter and paragraph as the folio numbers them, the folio as \`source_folio_shortId\` and the slug of its heading as \`sourceAnchor\`.
3. Do not invent requirements the folio does not state; list the ambiguities you met in one comment on the folio's epic or in your reply.
4. Check \`requirement_list\` afterwards: one requirement per statement, none twice.`;

  public static readonly useCaseDraft = `Draft the use cases for {{reference}}, "{{title}}", of the Lore project {{project}} ({{url}}): the ones that would verify this requirement, or that this epic delivers.

What it says:
{{steps}}

What already verifies it:
{{criteria}}

1. Read it in full (\`requirement_get\` or \`epic_get\`, number {{number}}) and the project's personas with \`persona_list\`.
2. For each goal a persona reaches through it, create one use case with \`usecase_create\`: a title, its actors, numbered steps, alternatives, and acceptance criteria in Given / When / Then.
3. Link each criterion that verifies a requirement with \`criterion_verify_link\`, and each use case to the epic that delivers it with \`usecase_link_epic\`.
4. Leave them in draft: a person validates a use case. Report what you created and what you were unsure of.`;
}
