import { Alepha, run } from "@alepha/core";

const alepha = Alepha.create();

if (import.meta.env.SSR) {
	alepha.with(await import("./users"));
}

run(alepha);
