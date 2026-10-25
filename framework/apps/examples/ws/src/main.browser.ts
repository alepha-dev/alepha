import { Alepha, run } from "alepha";
import { AlephaWebSocket } from "alepha/websocket";

import { AppRouter } from "./AppRouter.ts";
import { ChatChannels } from "./channels/ChatChannels.ts";

const alepha = Alepha.create();

alepha.with(AlephaWebSocket);
alepha.with(AppRouter);
alepha.with(ChatChannels);

run(alepha);
