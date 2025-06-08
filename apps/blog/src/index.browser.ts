import { Alepha, run } from "@alepha/core";
import { ReactAuthModule } from "@alepha/react-auth";
import { Blog } from "./Blog";

const alepha = Alepha.create();

alepha.with(Blog);
alepha.with(ReactAuthModule);

run(alepha);
