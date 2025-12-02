import { Alepha, run } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";
import { AppRouter } from "./AppRouter.ts";
import { AppSecurity } from "./AppSecurity.ts";

const alepha = Alepha.create();

alepha.with(AlephaApiFiles);
alepha.with(AppSecurity);
alepha.with(AppRouter);

run(alepha);
