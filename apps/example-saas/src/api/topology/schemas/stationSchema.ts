import { type Static, t } from "alepha";

export const stationSchema = t.object({
  id: t.uuid(),
  name: t.text(),
  code: t.text(),
  city: t.text(),
  country: t.text(),
  latitude: t.number(),
  longitude: t.number(),
  timezone: t.optional(t.text()),
  address: t.optional(t.text()),
  platforms: t.optional(t.integer()),
  description: t.optional(t.longText()),
  imageUrl: t.optional(t.text()),
});

export type StationResource = Static<typeof stationSchema>;
