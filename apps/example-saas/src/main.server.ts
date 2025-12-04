import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.ts";
import { AppSecurity } from "./AppSecurity.ts";
import { BookingService } from "./services/BookingService.ts";

const alepha = Alepha.create({
  env: {
    POSTGRES_SCHEMA: "saas",
  },
});

alepha.with(AppSecurity);
alepha.with(BookingService);
alepha.with(AppRouter);

run(alepha);
