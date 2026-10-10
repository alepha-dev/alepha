# mobile

The test bed of `@alepha/capacitor`: the app the native shell is built and
proven on ([epic E9](https://lore.alepha.dev/alepha/epics/9)). It is never
deployed and never submitted to a store.

It was scaffolded with `alepha init --preset saas` and carries what a real
mobile app needs:

- a `$realm` with password login and the stock `@alepha/ui` auth, account and
  admin pages;
- `/`, unprotected, whose loader calls the API (`GET /api/hello`), so a shell
  boots and fetches across origins without a session;
- `/notes`, protected, whose loader lists the signed-in user's notes, with a
  form that writes one and a delete behind a confirmation;
- a seeded account, `test@mobile.test` / `Mobile-test-1` (override with
  `MOBILE_TEST_EMAIL` and `MOBILE_TEST_PASSWORD`);
- a stalled-API switch: `MOBILE_API_STALL=true` accepts every `/api` and
  `/_auth` request and never answers it. The unreachable case needs no
  switch: stop the API.

## Run it in a browser

```bash
yarn w mobile dev
```

Then open http://localhost:3313.

## The browser suite

`yarn w mobile e2e` builds the API and the app shell (`alepha capacitor sync
--web-only --variant base`) and serves them on two e2e ports, then checks in Chromium that
the shell boots from `index.html`, that its first loader reaches the API on
the other origin, and that an unreachable or silent API lands on the offline
screen within the boot deadline, with a retry that recovers. It runs in CI's
`e2e-apps` job. A browser is not native: token transport, storage, deep links
and the native chrome are checked on devices.

## Serve the API to a phone over HTTPS

The Alepha server has no TLS listener, so a phone reaches the API through the
app's workerd build under local `wrangler dev`, with a certificate the phone
trusts. Nothing is deployed.

1. Install [mkcert](https://github.com/FiloSottile/mkcert) on the Mac and
   create its local CA once: `mkcert -install`.
2. Make a certificate naming the Mac's LAN address (here `192.168.1.48`):

   ```bash
   mkcert -cert-file mobile.pem -key-file mobile-key.pem 192.168.1.48 localhost 127.0.0.1
   ```

3. Build and serve:

   ```bash
   yarn w mobile build:workerd
   MOBILE_TLS_CERT=$PWD/mobile.pem MOBILE_TLS_KEY=$PWD/mobile-key.pem yarn w mobile serve:workerd
   ```

   The API answers on `https://192.168.1.48:8443` (`MOBILE_WORKERD_PORT`
   moves it). The script applies the migrations to a local D1 kept in
   `node_modules/.wrangler-mobile` first.

4. Trust the mkcert root on each phone. `mkcert -CAROOT` prints the folder
   holding `rootCA.pem`.
   - **iOS:** send `rootCA.pem` to the phone (AirDrop or mail), install the
     profile in Settings > General > VPN & Device Management, then turn on
     full trust in Settings > General > About > Certificate Trust Settings.
   - **Android:** copy `rootCA.pem` to the phone and install it in Settings >
     Security > Encryption & credentials > Install a certificate > CA
     certificate. Android apps ignore user CAs unless their network security
     config says otherwise, and the native project trusts them only in
     `debug-overrides`, so use a debug build.

Check from the phone's browser that `https://192.168.1.48:8443/api/hello`
loads without a warning.

## The native app

`alepha.config.ts` declares `capacitor({ ... })`, and `ios/` and `android/`
are checked in (made by `yarn alepha capacitor init`). The shell calls the API
named by `MOBILE_API_URL`, the HTTPS address of `serve:workerd` above:

```bash
export MOBILE_API_URL=https://192.168.1.48:8443
yarn alepha capacitor sync --variant base           # the shell into dist-capacitor/base/, then cap sync
yarn alepha capacitor build android --variant base  # a debug APK, recorded in capacitor.builds.json
yarn alepha capacitor build ios --variant base      # a simulator .app (--device for a phone, needs iosTeamId)
yarn alepha capacitor open ios --variant base       # Xcode
```

It declares a second variant, `acme`: another installable app (bundle id
`dev.alepha.mobile.acme`, name "Acme Notes", scheme `acmenotes://`, its own
icon) calling `MOBILE_ACME_API_URL`. Every command names the variant it works
on; switching rewrites the bundle id, name, scheme and icons in the one pair
of native projects, so build each in turn to install both side by side:

```bash
MOBILE_ACME_API_URL=https://192.168.1.48:8443 yarn alepha capacitor build android --variant acme
```

Android needs a JDK 21 (`JAVA_HOME` at Android Studio's
`Contents/jbr/Contents/Home` works) and the Android SDK. iOS needs Xcode with
the iOS platform its SDK names (Xcode > Settings > Components).

The full device run (simulators, an emulator and one physical phone per
platform) is [#Q2525](https://lore.alepha.dev/alepha/quests/2525).

## The OTA conformance harness

`scripts/ota-conformance.ts` checks the pinned live updater
(`@capgo/capacitor-updater` 8.52.1) on a simulator or emulator against a local
fixture service, with no Capgo account and no `ota-api` in between
([#Q2524](https://lore.alepha.dev/alepha/quests/2524)). It serves the
updater's endpoints over HTTPS, logs every request it receives, and seals test
bundles with the publisher's own code and a test-only key pair kept in
`node_modules/.ota-conformance/`: healthy ones, a broken one that never
acknowledges, one sealed with another key, a tampered one and one with
another bundle's checksum.

```bash
mkcert -cert-file ota.pem -key-file ota-key.pem localhost 127.0.0.1
OTA_TLS_CERT=$PWD/ota.pem OTA_TLS_KEY=$PWD/ota-key.pem node scripts/ota-conformance.ts
```

Then build the app with `alepha capacitor sync --variant base`, put the
updater's settings (`autoUpdate: false`, the three URLs on
`https://localhost:8444/ota/...`, `publicKey` from `/control/public-key`,
`allowManualBundleError: true`) into the generated native
`capacitor.config.json`, replace the native `public/` directory with
`/harness.html?version=builtin` as `index.html`, and build with Xcode or
Gradle. The harness page runs whatever `POST /control/command` queues
(`{"op":"download","args":{...}}`, `next`, `setBundleError`, `current`, ...)
against the plugin and posts the outcome to `/control/log`. An Android
emulator reaches the service through `adb reverse tcp:8444 tcp:8444`.
