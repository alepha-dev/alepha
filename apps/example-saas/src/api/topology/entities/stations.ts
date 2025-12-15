import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const stations = $entity({
  name: "stations",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    name: t.text({ title: "Station Name" }),
    code: t.text({
      title: "Station Code",
      description: "Unique identifier (e.g., PAR, LON, NYC)",
      minLength: 3,
      maxLength: 10,
    }),
    city: t.text({ title: "City" }),
    country: t.text({ title: "Country" }),

    // Geographic coordinates
    latitude: t.number({
      title: "Latitude",
      description: "Latitude coordinate (-90 to 90)",
      minimum: -90,
      maximum: 90,
    }),
    longitude: t.number({
      title: "Longitude",
      description: "Longitude coordinate (-180 to 180)",
      minimum: -180,
      maximum: 180,
    }),

    // Optional metadata
    timezone: t.optional(
      t.text({
        title: "Timezone",
        description: "IANA timezone (e.g., America/Toronto)",
      }),
    ),
    address: t.optional(t.text({ title: "Address", size: "long" })),
    platforms: t.optional(
      t.integer({
        title: "Number of Platforms",
        minimum: 1,
      }),
    ),
    description: t.optional(
      t.text({
        title: "Description",
        description: "Station description and features",
        size: "long",
      }),
    ),
    imageUrl: t.optional(
      t.text({
        title: "Image URL",
        description: "URL to station image",
      }),
    ),
  }),
  indexes: [{ columns: ["code"], unique: true }],
});

export type Station = Static<typeof stations.schema>;
