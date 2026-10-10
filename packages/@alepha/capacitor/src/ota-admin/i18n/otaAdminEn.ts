/**
 * English strings of the OTA admin, `ota.admin.*`.
 *
 * The components carry the same text as their `default:`, so an app whose
 * `fallbackLang` is English needs nothing. An app falling back to another
 * language spreads this into its English dictionary, or the fallback's
 * strings would show to English users:
 *
 * ```ts
 * en = $dictionary({ lazy: async () => ({ default: { ...otaAdminEn } }) });
 * ```
 */
export const otaAdminEn: Record<string, string> = {
  "ota.admin.apps.colAppId": "Bundle id",
  "ota.admin.apps.colChannel": "Default channel",
  "ota.admin.apps.colKey": "Publisher key",
  "ota.admin.apps.colName": "Name",
  "ota.admin.apps.create": "Register an app",
  "ota.admin.apps.createHint":
    "Paste the publisher's public key (-----BEGIN RSA PUBLIC KEY-----). Its private half stays with whoever publishes.",
  "ota.admin.apps.createSubmit": "Register",
  "ota.admin.apps.createTitle": "Register an app",
  "ota.admin.apps.empty": "No app receives live updates yet.",
  "ota.admin.apps.publicKey": "Public key",
  "ota.admin.bundles.archiveDigest": "Archive SHA-256",
  "ota.admin.bundles.builds": "Native builds",
  "ota.admin.bundles.bundle": "Encrypted bundle",
  "ota.admin.bundles.channel": "Published to",
  "ota.admin.bundles.ciphertextDigest": "Ciphertext SHA-256",
  "ota.admin.bundles.created": "Published",
  "ota.admin.bundles.kill": "Kill switch",
  "ota.admin.bundles.killConfirm":
    "$1 of $2 will never be served again, pins included. Devices holding it drop it, and devices running it fall back (or reset to their built-in web layer) at their next check. A device that stays offline keeps running it. The artifact is kept.",
  "ota.admin.bundles.killTitle": "Kill this bundle?",
  "ota.admin.bundles.manifest": "Manifest",
  "ota.admin.bundles.promote": "Serve from a channel",
  "ota.admin.bundles.promoteHint":
    "Rollout starts small (10 percent by default): a stable share of the channel's devices gets it at their next check.",
  "ota.admin.bundles.promoteTitle": "Serve $1",
  "ota.admin.bundles.publish": "Publish",
  "ota.admin.bundles.size": "Size",
  "ota.admin.bundles.status": "Status",
  "ota.admin.bundles.upload": "Upload a release",
  "ota.admin.bundles.uploadHint":
    "The two files alepha capacitor release --dry-run writes: the manifest (.json) and the encrypted bundle (.zip). A raw ZIP is refused.",
  "ota.admin.bundles.version": "Version",
  "ota.admin.cancel": "Cancel",
  "ota.admin.channels.close": "Close to devices",
  "ota.admin.channels.create": "New channel",
  "ota.admin.channels.createHint":
    "A private channel is reached through a device override. A self-assignable one, by any device that asks.",
  "ota.admin.channels.default": "Default",
  "ota.admin.channels.kill": "Kill switch",
  "ota.admin.channels.killConfirm":
    "Every bundle channel $1 of $2 serves is killed. Each device falls back to its cohort's fallback, or resets to its built-in web layer, at its next check. A device that stays offline keeps what it runs.",
  "ota.admin.channels.killTitle": "Kill this channel?",
  "ota.admin.channels.name": "Name",
  "ota.admin.channels.noCohort": "Nothing published to this channel yet.",
  "ota.admin.channels.open": "Open to devices",
  "ota.admin.channels.public": "Self-assignable",
  "ota.admin.channels.selfAssign": "Devices may assign themselves",
  "ota.admin.cohort.active": "Active",
  "ota.admin.cohort.bundle": "Bundle",
  "ota.admin.cohort.fallback": "Choose fallback",
  "ota.admin.cohort.fallbackColumn": "Fallback",
  "ota.admin.cohort.fallbackHint":
    "What devices outside the rollout get, and what a killed active bundle gives way to. None means the built-in web layer.",
  "ota.admin.cohort.fingerprint": "Native fingerprint",
  "ota.admin.cohort.platform": "Platform",
  "ota.admin.cohort.rollback": "Roll back",
  "ota.admin.cohort.rollbackHint":
    "Serve an earlier bundle to the whole cohort, even an older version. Devices switch at their next check, then on their next background or restart.",
  "ota.admin.cohort.rollout": "Change rollout",
  "ota.admin.cohort.rolloutHint":
    "The share of this cohort that gets the active bundle. The others get the fallback. 0 is nobody, 100 is everybody.",
  "ota.admin.cohort.share": "Rollout",
  "ota.admin.create": "Create",
  "ota.admin.devices.build": "Native build",
  "ota.admin.devices.channel": "Channel",
  "ota.admin.devices.device": "Device",
  "ota.admin.devices.failed": "Rolled back from",
  "ota.admin.devices.hint":
    "Seen in the last 7 days. Telemetry the devices sent, not a live presence.",
  "ota.admin.devices.running": "Running",
  "ota.admin.devices.seen": "Last seen",
  "ota.admin.kill": "Kill",
  "ota.admin.nav": "Live updates",
  "ota.admin.navGroup": "Live updates",
  "ota.admin.overrides.create": "Assign a device",
  "ota.admin.overrides.hint":
    "A channel, a pinned bundle, or both. The pin wins while its bundle is servable.",
  "ota.admin.overrides.note": "Note",
  "ota.admin.overrides.pinned": "Pinned bundle",
  "ota.admin.overrides.remove": "Remove",
  "ota.admin.overrides.removeConfirm":
    "Device $1 goes back to its own channel at its next check.",
  "ota.admin.overrides.removeTitle": "Remove this override?",
  "ota.admin.save": "Save",
  "ota.admin.settings.delete": "Delete app",
  "ota.admin.settings.deleteConfirm":
    "$1 stops receiving live updates: its channels, bundles and device records go, and installed apps keep the web layer they run.",
  "ota.admin.settings.deleteTitle": "Delete this app?",
  "ota.admin.settings.keyHint":
    "Changing it is a key rotation: bundles sealed with the old key are refused, and binaries carrying the old key cannot run new bundles.",
  "ota.admin.settings.keys": "API keys allowed to publish (ids)",
  "ota.admin.status.deleted": "Deleted",
  "ota.admin.status.failed": "Failed",
  "ota.admin.status.killed": "Killed",
  "ota.admin.status.ready": "Ready",
  "ota.admin.status.uploading": "Uploading",
  "ota.admin.tab.bundles": "Bundles",
  "ota.admin.tab.channels": "Channels",
  "ota.admin.tab.devices": "Devices",
  "ota.admin.tab.overrides": "Device overrides",
  "ota.admin.tab.settings": "Settings",
};
