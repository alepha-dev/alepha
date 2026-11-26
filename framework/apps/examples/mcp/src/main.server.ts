import { Alepha, run } from "alepha";
import { AlephaMcp, StreamableHttpMcpTransport } from "alepha/mcp";

import { SalesTools } from "./SalesTools.ts";

const alepha = Alepha.create({ env: { APP_NAME: "MCP example" } })
  .with(AlephaMcp)
  .with(StreamableHttpMcpTransport)
  .with(SalesTools);

run(alepha);
