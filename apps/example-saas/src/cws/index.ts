import { alephaThemeListAtom, defaultTheme, midnightTheme } from "@alepha/ui";
import { $module } from "alepha";
import { CwsRouter } from "./CwsRouter.ts";
import { BookingService } from "./services/BookingService.ts";

export * from "./atoms/bookingAtom.ts";
export * from "./CwsRouter.ts";

export const SaasCws = $module({
  name: "saas.cws",
  services: [CwsRouter, BookingService],
  register: (alepha) => {
    alepha.with(CwsRouter).with(BookingService);
    alepha.set(alephaThemeListAtom, [
      defaultTheme,
      {
        ...midnightTheme,
        primaryColor: "pink",
        fontFamily: "wotfardregular",
        defaultColorScheme: "dark",
      },
    ]);
  },
});
