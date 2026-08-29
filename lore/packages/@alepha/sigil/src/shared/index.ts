/**
 * The protocol tier: everything a reporter and a sink must agree on, and
 * nothing that costs anything to import.
 *
 * Re-exported by both `index.ts` and `index.browser.ts` so the single public
 * entry carries it under every condition. It is a directory barrel rather than
 * ten public subpaths because these files pull `alepha` and nothing else - the
 * split bought no consumer a smaller graph, since every one of them already
 * loads the module, and it cost the package thirteen export paths that would
 * have been frozen by the first release.
 */
export * from "./schemas/sigilConfig.ts";
export * from "./schemas/sigilEnvelope.ts";
export * from "./schemas/sigilReportedConfig.ts";
export * from "./schemas/sigilVitalsBuckets.ts";
export * from "./sigilCampaign.ts";
export * from "./sigilClientAtom.ts";
export * from "./sigilDeviceClass.ts";
export * from "./sigilFeatures.ts";
export * from "./sigilFeedbackContext.ts";
export * from "./sigilFeedbackPosition.ts";
export * from "./sigilFingerprint.ts";
export * from "./sigilGlobMatch.ts";
export * from "./sigilHost.ts";
export * from "./sigilKey.ts";
export * from "./sigilMessages.ts";
export * from "./sigilPaths.ts";
export * from "./sigilReferrerHost.ts";
export * from "./sigilScrubUrl.ts";
export * from "./sigilTrafficKind.ts";
export * from "./sigilUserAgent.ts";
