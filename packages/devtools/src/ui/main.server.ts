import { Alepha, run } from "@alepha/core";
import { AlephaDevtools } from "../index.ts";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha.with(AppRouter);
alepha.with(AlephaDevtools);

run(alepha);
