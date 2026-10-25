# calculator

The smallest native app `@alepha/capacitor` makes: a calculator with no
backend, which runs offline on iOS and Android. It is never deployed and never
submitted to a store.

There is one page, with no loader, no `$client` and no auth module, so nothing
waits on a network: the bundled shell boots the same in airplane mode. The
arithmetic lives in `CalculatorEngine`, as pure state transitions with specs of
their own. Each key press taps the phone's haptics through `HapticsProvider`.

`apiUrl` in `alepha.config.ts` is a placeholder: `alepha capacitor sync`
refuses a shell without one, even for an app that never calls it.

For the API-backed path (sign-in, loaders, the offline screen), see
`apps/examples/mobile`.

## Run it

```bash
yarn w calculator dev       # in a browser, http://localhost:3314
yarn w calculator ios       # bundled, on an iOS simulator
yarn w calculator android   # bundled, on an Android emulator or phone
```

`ios` and `android` build the shell and hand over to `cap run`, which asks for
a target; pass one with `--target <id>`. Android needs `JAVA_HOME` (Android
Studio's `Contents/jbr/Contents/Home`) and `ANDROID_HOME`.

`dev:ios` and `dev:android` run the app from the Vite dev server inside the
native shell instead, with hot reload: that needs this machine reachable, so
it is not the offline app.

The native projects in `ios/` and `android/` were made by
`yarn alepha capacitor init` and are checked in.
