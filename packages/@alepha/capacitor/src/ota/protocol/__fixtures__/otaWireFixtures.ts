/**
 * The wire contract between the pinned updater (`@capgo/capacitor-updater`
 * 8.52.1) and `ota-api`, as fixtures both sides' specs consume: the device
 * client's (#Q1312) against the answers, the server's (#Q1303) against the
 * requests and the answers it must produce.
 *
 * Requests mirror what the plugin writes (`InfoObject`, `StatsEvent` in
 * `ios/Sources/CapacitorUpdaterPlugin/InternalUtils.swift`, the same fields
 * from `CapgoUpdater.java`), captured from the iOS 26.5 simulator and the
 * Android 16 emulator on 2026-10-10 (#Q2524's evidence folio). Answers are this
 * server's, shaped to what the plugin decodes (`AppVersionDec`,
 * `SetChannelDec`, `GetChannelDec`, `ListChannelsDec`).
 *
 * Not a public export: specs import it by path.
 */
export const otaWireFixtures = {
  updateRequestIos: {
    owner: "Q1303",
    method: "POST",
    path: "/ota/updates",
    // Captured on the iOS 26.5 simulator, 2026-10-10. On the built-in web
    // layer `version_name` is the store version, not "builtin".
    body: {
      version_name: "1.0",
      device_id: "6574924e-4ddb-42ed-85c2-afc33e02ee0f",
      custom_id: "",
      app_id: "dev.alepha.mobile",
      key_id: "MIIBCgKCAQEAwDf0VEsl",
      platform: "ios",
      version_os: "26.5",
      version_code: "1",
      is_prod: false,
      plugin_version: "8.52.1",
      is_emulator: true,
      version_build: "1.0",
      defaultChannel: "",
    },
  },
  updateRequestAndroid: {
    owner: "Q1303",
    method: "POST",
    path: "/ota/updates",
    // Captured on the Android 16 emulator, 2026-10-10, running a bundle.
    body: {
      platform: "android",
      device_id: "e4e676ba-05d3-464e-a4fd-7320ccd8f605",
      app_id: "dev.alepha.mobile",
      custom_id: "",
      version_build: "1.0",
      version_code: "1",
      version_os: "16",
      version_name: "conf-2",
      plugin_version: "8.52.1",
      is_emulator: true,
      is_prod: false,
      install_source: "",
      defaultChannel: "beta",
      key_id: "MIIBCgKCAQEAwDf0VEsl",
    },
  },
  updateAvailable: {
    owner: "Q1312",
    status: 200,
    body: {
      version: "1.0.0-20261010T121500",
      url: "https://api.example.test/ota/bundles/0199d6a2-7f3b-7c1e-9d4f-5a6b7c8d9e0f/download?t=eyJ.signed",
      session_key:
        "c9CtcTiefMacBCB7+Qk9SQ==:lqNKFGVy9WK0QbBXwcIGPnshUnn8FVxmmIMcagSDjHZ2",
      checksum:
        "24ca3ea50fcb6965acd439e0ada19703db58af0ad23e331090a5319d125400809623a567",
    },
  },
  updateNone: {
    owner: "Q1312",
    status: 200,
    body: {
      error: "no_new_version_available",
      message: "No new version available",
      kind: "up_to_date",
    },
  },
  updateBuiltin: {
    owner: "Q1312",
    status: 200,
    body: {
      version: "builtin",
      message: "Reset to the built-in bundle",
    },
  },
  updateBlocked: {
    owner: "Q1312",
    status: 200,
    body: {
      error: "unknown_native_build",
      message: "No release targets ios build 7 of dev.alepha.mobile",
      kind: "blocked",
    },
  },
  updateMalformed: {
    owner: "Q1312",
    status: 400,
    body: {
      error: "invalid_request",
      message: "The update request is malformed",
      kind: "failed",
    },
  },
  statsBatch: {
    owner: "Q1303",
    method: "POST",
    path: "/ota/stats",
    body: [
      {
        platform: "ios",
        device_id: "6574924e-4ddb-42ed-85c2-afc33e02ee0f",
        app_id: "dev.alepha.mobile",
        custom_id: "",
        version_build: "1.0",
        version_code: "1",
        version_os: "26.5",
        version_name: "conf-2",
        old_version_name: "1.0",
        plugin_version: "8.52.1",
        is_emulator: true,
        is_prod: false,
        install_source: "app_store",
        action: "set",
        defaultChannel: "",
        key_id: "MIIBCgKCAQEAvq3Zu1kN",
        metadata: { source: "next" },
        timestamp: 1760098500000,
      },
    ],
  },
  statsSingle: {
    owner: "Q1303",
    method: "POST",
    path: "/ota/stats",
    body: {
      platform: "android",
      device_id: "4f6c0b4e-2f6e-4b47-9a52-0c8f8c2d6e11",
      app_id: "dev.alepha.mobile",
      version_code: "1",
      version_name: "1.0",
      old_version_name: "",
      plugin_version: "8.52.1",
      action: "rate_limit_reached",
    },
  },
  statsAccepted: {
    owner: "Q1312",
    status: 200,
    body: { status: "ok" },
  },
  channelSetRequest: {
    owner: "Q1303",
    method: "POST",
    path: "/ota/channel",
    body: {
      platform: "ios",
      device_id: "6574924e-4ddb-42ed-85c2-afc33e02ee0f",
      app_id: "dev.alepha.mobile",
      version_code: "1",
      version_name: "1.0",
      plugin_version: "8.52.1",
      channel: "beta",
    },
  },
  channelSetAccepted: {
    owner: "Q1312",
    status: 200,
    body: { status: "ok", message: "Channel set to beta" },
  },
  channelSetPublic: {
    owner: "Q1312",
    status: 200,
    body: {
      status: "ok",
      unset: true,
      message: "Following the public channel",
    },
  },
  channelSetRefused: {
    owner: "Q1312",
    status: 403,
    body: {
      status: "error",
      error: "channel_self_set_not_allowed",
      message: "This channel does not accept devices assigning themselves",
    },
  },
  channelGetRequest: {
    owner: "Q1303",
    method: "PUT",
    path: "/ota/channel",
    body: {
      platform: "android",
      device_id: "4f6c0b4e-2f6e-4b47-9a52-0c8f8c2d6e11",
      app_id: "dev.alepha.mobile",
      version_code: "1",
      version_name: "1.0",
      plugin_version: "8.52.1",
      defaultChannel: "",
    },
  },
  channelGetAnswer: {
    owner: "Q1312",
    status: 200,
    body: { channel: "production", status: "default", allowSet: true },
  },
  channelListRequest: {
    owner: "Q1303",
    method: "GET",
    path: "/ota/channel",
    // `listChannels()` sends the device as a query string, every value a
    // string, booleans included. Captured on the iOS 26.5 simulator.
    query: {
      version_name: "conf-2",
      plugin_version: "8.52.1",
      version_code: "1",
      key_id: "MIIBCgKCAQEAwDf0VEsl",
      version_build: "1.0",
      is_prod: "false",
      custom_id: "",
      app_id: "dev.alepha.mobile",
      is_emulator: "true",
      device_id: "6574924e-4ddb-42ed-85c2-afc33e02ee0f",
      platform: "ios",
      defaultChannel: "production",
      version_os: "26.5",
    },
  },
  channelListAnswer: {
    owner: "Q1312",
    status: 200,
    body: [{ id: 1, name: "beta", public: false, allow_self_set: true }],
  },
} as const;
