import { Alepha, run } from "alepha";
import { AlephaWebSocket } from "alepha/websocket";

import { AppChatServer } from "./AppChatServer.ts";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AlephaWebSocket);
alepha.with(AppRouter);
alepha.with(AppChatServer);

run(alepha);
