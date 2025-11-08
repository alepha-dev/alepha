import { Alepha, run } from "@alepha/core";
import { AlephaDevtools } from "../index.ts";

const alepha = Alepha.create();

alepha.with(AlephaDevtools);

run(alepha);
