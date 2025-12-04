import { $repository } from "alepha/orm";
import { bookings } from "../entities/bookings.ts";
import { payments } from "../entities/payments.ts";
import { stations } from "../entities/stations.ts";
import { trips } from "../entities/trips.ts";

export class Db {
  stations = $repository(stations);
  trips = $repository(trips);
  bookings = $repository(bookings);
  payments = $repository(payments);
}
