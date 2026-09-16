/**
 * The conventions block at the top of `lore -h`: what cannot be discovered one
 * command at a time.
 *
 * The help is the CLI's only documentation (the owner's answer to epic #E45's
 * question 4): no skill, no guide page, nothing that can drift from the binary.
 * Each command's own help carries its flags; this carries what spans them.
 *
 * ⚠️ At most twelve lines. Past that it is a manual, and it pushes the command
 * list off the screen. `LoreConventions.spec.ts` counts.
 */
export class LoreConventions {
  public static describe(version: string): string {
    return [
      `Lore CLI v${version} - projects, quests, folios and deploys, from a shell or a CI job.`,
      "",
      "  Auth      lore login on a machine with a browser; LORE_API_KEY in CI; LORE_URL to self-host.",
      "  Project   -p <slug>, or LORE_PROJECT.",
      "  Naming    the MCP tool quest_create is lore quest create: singular, underscore to space.",
      "  Output    human by default; --output json for a script. Logs go to stderr.",
      "  Bodies    @file, or @- for stdin, on the flags whose help says so.",
      "  Refs      12, Q12 or '#Q12' (quote the #); F12 for a folio; 45 or E45 for an epic.",
      "  Exit      0 ok, 1 failure or partial write, 3 not authenticated, 4 forbidden",
      "            (for project, quest and folio).",
    ].join("\n");
  }
}
