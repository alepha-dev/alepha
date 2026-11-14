import { z } from "alepha";

import { monitorIncidents } from "../entities/monitorIncidents.ts";
export const monitorIncidentResourceSchema = monitorIncidents.schema
  .omit({ monitorId: true, openKey: true })
  .extend({ durationSecs: z.number().min(0) });
