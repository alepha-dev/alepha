import { AlephaReact } from "@alepha/react";
import { Alepha, run } from "alepha";
import { AlephaWebSockets } from "alepha/websocket";
import { AppRouter } from "./AppRouter.ts";
import { ChatClient } from "./ChatClient.ts";

const alepha = Alepha.create();

alepha.with(AlephaWebSockets);
alepha.with(AlephaReact);
alepha.with(AppRouter);
alepha.with(ChatClient);

run(alepha);
