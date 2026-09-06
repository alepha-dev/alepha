import { CapabilityRegistry } from "@/api/services/CapabilityRegistry.ts";

/**
 * The capability declarations, for the web.
 *
 * A module-level instance rather than a DI registration, and both halves of
 * that are deliberate.
 *
 * **Not registered on the web container.** Adding `CapabilityRegistry` to the
 * web module's `services` array made `alepha build`'s analyze step fail with
 * "Service already substituted ... substitute `SigilSinkProvider` with
 * `LoreSigilSinkProvider` before using it": one more service in that array
 * moves when the container is walked, and the sink substitution is ordered
 * against that walk. The registry has nothing to do with the sink, and paying
 * for that coupling to reach a constant list is the wrong trade.
 *
 * **Not injected, because there is nothing to substitute.** The repo's rule
 * that everything lives in a class exists so services stay swappable for
 * tests; this class holds no repository, no clock and no I/O - it is the
 * declarations themselves. `projectFixture` constructs its own for the same
 * reason. The documented precedents for a module-level const are
 * `$ownsProject` and `defaultAppInstance`.
 *
 * One instance rather than one per component: the sidebar, the wizard and the
 * settings pages all read it, and three copies of a constant list is three
 * chances for them to be different lists.
 */
export const capabilityRegistry = new CapabilityRegistry();
