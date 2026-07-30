import { $module } from "alepha";
import { StreamableHttpMcpTransport } from "alepha/mcp";
import { PulseTools } from "./tools/PulseTools.ts";

/**
 * Pulse over MCP — read-only.
 *
 * The point is triage without a browser: an agent can ask which app is down,
 * what broke in the last release, and what the memory was doing around it,
 * without anyone opening a dashboard or an SSH session.
 *
 * Nothing here writes. Deploying or revoking from an agent would be a second
 * control plane beside the panel that already has one, with its own
 * authorization surface to get right — and Bay's control deliberately never
 * travels the network.
 */
export const PulseMcp = $module({
  name: "pulse.mcp",
  services: [StreamableHttpMcpTransport, PulseTools],
});
