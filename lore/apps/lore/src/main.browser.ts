import { Alepha, run } from "alepha";
import { LoreWebAdmin } from "@/web/admin/index.ts";
import { LoreWebApp } from "./web/app/index.ts";

const alepha = Alepha.create();

alepha.with(LoreWebApp);
alepha.with(LoreWebAdmin);

run(alepha);
