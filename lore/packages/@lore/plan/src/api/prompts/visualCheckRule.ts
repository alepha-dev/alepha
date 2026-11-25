/**
 * The look every build prompt takes at a change a person sees (#Q4346): the
 * checks prove what a spec asserts, and a new or restyled screen usually has
 * none yet. With `playwright-cli` on the Agent host the agent opens the
 * screen it changed; without it, it says no visual check was made. How to
 * start the app is the repository's own business: Lore names no tooling.
 * A job reaches Lore through MCP only and cannot attach a file, so what it
 * saw is described in words (option 3 of the quest, the owner's call that
 * jobs stay MCP-only).
 */
export const visualCheckRule = `## A look at what the user sees

When a change is visible in the UI (a new screen, a restyle, a moved control, a changed label), look at it before you commit, as a person would. The checks prove what a spec asserts, and a screen with no spec yet can pass them broken.

- **When \`playwright-cli\` is on the host** (\`command -v playwright-cli\`): start the app as the repository's agent instructions say, on a port of its own that no other run uses, open each changed screen with \`playwright-cli\`, and compare it with what the quest asks, in light and dark when the app has both. Fix what is wrong, then stop the app.
- **Without it**, or when the app cannot be started here, make no visual check and do not pretend to.
- Either way, the quest's closing note says what was looked at, which screens and what you saw, or that no visual check was made and why. You cannot attach a screenshot: describe it in words.

The browser runs as this job's user, with no sandbox: open only the app you started.`;
