/**
 * The words of Requirements' built-in prompts (#Q4343), the registry's
 * versions of the Verify dialog's six kinds (`RequirementsPromptDefaults`):
 * one-shot, since nobody answers a run, so no step asks for anything.
 *
 * ⚠️ English, never localized: their words name the tools they call. No
 * secret ever goes in: they leave Lore on a clipboard or in a job.
 */

/**
 * Where a run plays the app: no arg names the copy, so the run finds one.
 */
const whereRule = (environment: string) => `## Where

The persona's environment: ${environment}. Find its copy and URL with \`app_instance_list\` (project_name "{{project}}"). With no copy named, take a development, staging or preview copy, or else run the app from the repository as its AGENTS.md or README says. Never play it against production.

Play it in a real browser, as the persona would: with \`playwright-cli\` when it is on the host (\`command -v playwright-cli\`), opening only that copy. Without a browser, say what you could not play and why: reading the code is not a run.`;

/**
 * How a run signs in (#Q4343): nobody can hand it a password mid-run, and
 * Lore stores none, so it makes its own account when it was given none.
 */
const signInRule = (demoAccount: string) => `## Signing in

The persona's demo account is ${demoAccount}; Lore never holds its password.

- If this run was given that account's credentials (in the environment, or in a seed the repository documents), sign in with them.
- Otherwise create a fresh account through the app's own sign-up, with an e-mail address and a password you generate for this run, and give it the persona's role if the app lets a new account take it. Never write that password into Lore, a commit, a comment or your reply.
- If the app has no sign-up, needs a step you cannot take (an e-mail you cannot read, an invitation), or the new account cannot reach the persona's role, do what you can without it and say so: what you could not reach is \`not_run\`, with the reason.`;

export const testUseCasePromptText = `You are testing use case {{useCase.reference}}, "{{useCase.title}}", of the Lore project "{{project}}" ({{useCase.url}}). Play it; fix nothing.

As: {{useCase.persona}}

Scenario:
{{useCase.steps}}

Acceptance criteria:
{{useCase.criteria}}

${whereRule("{{useCase.environment}}")}

${signInRule("{{useCase.demoAccount}}")}

## The run

1. Play the main flow and every alternative, in each actor's role.
2. For each criterion, decide passed, failed or not_run. A failure's note reads for a person first, one line per label: \`Expected: <what should happen>\`, \`Seen: <what happened>\`, \`Also: <anything else worth knowing>\` if any, then \`Details: <page, state, repro steps, ids>\` for the developer. Lore shows the first three as rows and folds the details.
3. Record ONE run with \`usecase_run_record\` (project_name "{{project}}", number {{useCase.number}}, by "agent", your client name, the app and env you played, one result per criterion), or \`lore usecase run record {{useCase.reference}} --by agent --result C1=passed,C2=failed:why\`.
4. Attach your screenshots or recording to the criterion they show with \`lore attachments push <file> --run <runId> --criterion C2\` (\`usecase_run_attachment_add\` gives you that line).
5. A failure opens an error only once every quest covering the use case is done and the project tracks errors; do not open quests or fix code yourself. End with what failed and where.`;

export const writeUseCaseSpecPromptText = `Write the end-to-end spec of use case {{useCase.reference}}, "{{useCase.title}}", of the Lore project "{{project}}" ({{useCase.url}}).

Scenario:
{{useCase.steps}}

Acceptance criteria:
{{useCase.criteria}}

1. Work in a git worktree of your own, on a new branch cut from the latest main.
2. Write one test per acceptance criterion, each tagged \`@U{{useCase.number}}\` and naming its key (\`C2\`) in its title, so the Lore Playwright reporter (\`@alepha/lore/playwright\`) records the run from CI.
3. Sign in as {{useCase.persona}} through an account the test creates itself, or the demo account ({{useCase.demoAccount}}) the app's own seed provides; never commit a password.
4. Run the project's local checks, push, open a pull request into main, and wait for CI. Never merge it yourself.
5. Record the spec's path and tag on the use case with \`usecase_update\` (automatedTestPath, automatedTestTag), and end with the pull request's link.`;

export const prepareUseCaseDemoPromptText = `Prepare a demo of use case {{useCase.reference}}, "{{useCase.title}}", of the Lore project "{{project}}" ({{useCase.url}}).

As: {{useCase.persona}} (demo account: {{useCase.demoAccount}})

Scenario:
{{useCase.steps}}

1. Read the use case with \`usecase_get\` (project_name "{{project}}", number {{useCase.number}}).
2. Write a demo script: what to show, in order, and what to say at each step.
3. List the data the demo needs and how the app's seed provides it; read the repository to check it does.
4. File the script as a folio with \`folio_create\`, and link it from the use case with a comment (\`usecase_comment_add\`). End with the folio's link.`;

export const exploreAsPersonaPromptText = `Explore the app as the persona {{persona.reference}}, "{{persona.title}}", of the Lore project "{{project}}" ({{persona.url}}): {{persona.role}}.

Their use cases:
{{persona.useCases}}

${whereRule("{{persona.environment}}")}

${signInRule("{{persona.demoAccount}}")}

## The run

1. Read the persona with \`persona_get\` (project_name "{{project}}", number {{persona.number}}) and its use cases with \`usecase_get\`.
2. Use the app in their shoes for half an hour: the tasks they come for, the way they would do them.
3. List every friction you meet, each cited against a requirement (\`requirement_list\`) where one applies, and comment them on the persona with \`persona_comment_add\`.
4. Change nothing in the code. End with the frictions, most serious first.`;

export const importSpecificationPromptText = `Import the specification {{folio.reference}}, "{{folio.title}}", of the Lore project "{{project}}" ({{folio.url}}) as requirements.

1. Read the folio with \`folio_get\` (project_name "{{project}}", shortId {{folio.number}}).
2. For each requirement it states (a "must", "should" or "can" sentence, a numbered rule), create one with \`requirement_create\`: its statement in one sentence, its type (functional, non_functional, constraint), its MoSCoW priority, its chapter and paragraph as the folio numbers them, the folio as \`source_folio_shortId\` and the slug of its heading as \`sourceAnchor\`.
3. Do not invent requirements the folio does not state. Put the ambiguities you met in one comment on the folio's epic if it has one, and in your reply.
4. Check \`requirement_list\` afterwards: one requirement per statement, none twice. End with how many you created.`;

const draftSteps = (
  reference: string,
  number: string,
  read: string,
) => `1. Read it in full (\`${read}\`, number ${number}) and the project's personas with \`persona_list\`.
2. For each goal a persona reaches through it, create one use case with \`usecase_create\`: a title, its actors, numbered steps, alternatives, and acceptance criteria in Given / When / Then.
3. Link each criterion that verifies a requirement with \`criterion_verify_link\`, and each use case to the epic that delivers it with \`usecase_link_epic\`.
4. Leave them in draft: a person validates a use case. End with what you created for ${reference} and what you were unsure of.`;

export const draftUseCasesPromptText = `Draft the use cases that would verify requirement {{requirement.reference}}, "{{requirement.title}}", of the Lore project "{{project}}" ({{requirement.url}}).

What it says:
{{requirement.description}}

What already verifies it:
{{requirement.verifiedBy}}

${draftSteps("{{requirement.reference}}", "{{requirement.number}}", "requirement_get")}`;

export const draftEpicUseCasesPromptText = `Draft the use cases that epic {{epic.reference}}, "{{epic.title}}", of the Lore project "{{project}}" delivers ({{epic.url}}).

${draftSteps("{{epic.reference}}", "{{epic.number}}", "epic_get")}`;
