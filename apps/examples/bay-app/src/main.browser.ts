import { AlephaSigil } from "@alepha/sigil";
import { Alepha, run } from "alepha";
import { AppRouter } from "./web/AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AppRouter);

// Registered here as well as on the server entry, because they are two
// containers. The server half is the same-origin proxy that forwards to Sigil;
// the browser half is what collects page views, vitals and client errors in the
// first place. On the server alone it is a relay with nothing to relay.
alepha.with(AlephaSigil);

run(alepha);
