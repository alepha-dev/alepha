import { z } from "alepha";

export const automationOutboxIdsSchema = z.array(z.uuid()).max(100);
