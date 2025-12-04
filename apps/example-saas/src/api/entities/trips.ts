import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";
import { stations } from "./stations.ts";

export const trips = $entity({
  name: "trips",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Route
    departureStationId: pg.ref(t.uuid(), () => stations.cols.id),
    arrivalStationId: pg.ref(t.uuid(), () => stations.cols.id),

    // Schedule
    departureTime: t.text(), // "06:15"
    arrivalTime: t.text(), // "08:47"
    duration: t.text(), // "2h 32min"

    // Train info
    trainNumber: t.text(),
    trainType: t.text(), // TGV, ICE, Eurostar

    // Pricing & availability
    basePrice: t.number(),
    availableSeats: t.integer(),

    // Active flag
    active: pg.default(t.boolean(), true),
  }),
  indexes: [
    { columns: ["departureStationId", "arrivalStationId"] },
    { columns: ["trainNumber"], unique: true },
  ],
});

export type Trip = Static<typeof trips.schema>;
