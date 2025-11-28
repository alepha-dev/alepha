import { Alepha, run } from "alepha";
import { AlephaWebSockets } from "alepha/websocket";
import { ChatServer } from "./ChatServer.ts";

const alepha = Alepha.create();

alepha.with(AlephaWebSockets);
alepha.with(ChatServer);

run(alepha);
