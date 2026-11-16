import { type Infer, z } from "alepha";

/**
 * Who played a use case run (#E153): an agent, the CI, or a person.
 */
export const runBySchema = z.enum(["agent", "ci", "person"]);

export type RunBy = Infer<typeof runBySchema>;
