import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

import { codeRepositorySlugSchema } from "../../api/schemas/codeRepositorySlugSchema.ts";

/**
 * The params of the six code-read tools (#Q4139), one for one with `lore
 * code tree|cat|log|show|diff|blame`.
 */
const repo = codeRepositorySlugSchema
  .describe(
    "The repository. Defaults to the one named like the project, else the project's only one.",
  )
  .optional();
const ref = z
  .string()
  .max(255)
  .describe(
    "A branch, a tag or a commit sha (7 characters or more). Defaults to the repository's default branch.",
  )
  .optional();

export const codeTreeParamsSchema = projectParamsSchema
  .extend({
    repo,
    ref,
    path: z
      .string()
      .max(4096)
      .describe(
        "A directory, from the repository's root. Defaults to the root.",
      )
      .optional(),
  })
  .strict();

export const codeFileParamsSchema = projectParamsSchema
  .extend({
    repo,
    ref,
    path: z
      .string()
      .min(1)
      .max(4096)
      .describe("The file, from the repository's root."),
    start_line: z
      .integer()
      .min(1)
      .describe("The first line to answer, 1-based. Defaults to 1.")
      .optional(),
    end_line: z
      .integer()
      .min(1)
      .describe(
        "The last line to answer, inclusive. At most 200 lines a call; the answer says how to ask for the rest.",
      )
      .optional(),
  })
  .strict();

export const codeLogParamsSchema = projectParamsSchema
  .extend({
    repo,
    ref,
    path: z
      .string()
      .max(4096)
      .describe("Only the commits that touched this file or folder.")
      .optional(),
    page: z
      .integer()
      .min(0)
      .describe("The page, 30 commits each, from 0.")
      .optional(),
  })
  .strict();

export const codeCommitParamsSchema = projectParamsSchema
  .extend({
    repo,
    sha: z
      .string()
      .min(4)
      .max(40)
      .describe("The commit: a full sha or a unique prefix."),
  })
  .strict();

export const codeDiffParamsSchema = projectParamsSchema
  .extend({
    repo,
    from: z
      .string()
      .max(255)
      .describe(
        "The old side: a branch, a tag or a sha. Omitted, the diff is from the empty tree.",
      )
      .optional(),
    to: z.string().max(255).describe("The new side: a branch, a tag or a sha."),
    path: z
      .string()
      .max(4096)
      .describe(
        "One file: its hunks, as a unified diff. Without it, the changed files, a page of 50.",
      )
      .optional(),
    page: z
      .integer()
      .min(0)
      .describe("The file list's page, from 0.")
      .optional(),
  })
  .strict();

export const codeBlameParamsSchema = projectParamsSchema
  .extend({
    repo,
    ref,
    path: z
      .string()
      .min(1)
      .max(4096)
      .describe("The file, from the repository's root."),
    start_line: z
      .integer()
      .min(1)
      .describe("The first line, 1-based. Defaults to 1.")
      .optional(),
    end_line: z
      .integer()
      .min(1)
      .describe("The last line, inclusive. At most 200 lines a call.")
      .optional(),
  })
  .strict();
