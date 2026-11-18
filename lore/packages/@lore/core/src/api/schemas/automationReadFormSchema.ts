import { z } from "alepha";

/**
 * What a schedule reads, picked in its row of the outline editor (#Q3848).
 */
export const automationReadFormSchema = z.object({ read: z.string() });
