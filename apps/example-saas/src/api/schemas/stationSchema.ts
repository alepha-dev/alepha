import { type Static, t } from "alepha";

export const stationSchema = t.object({
  id: t.uuid(),
  name: t.text(),
  code: t.text(),
  city: t.text(),
  country: t.text(),
});

export type StationResource = Static<typeof stationSchema>;
