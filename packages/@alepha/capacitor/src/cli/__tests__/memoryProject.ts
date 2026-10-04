import type { MemoryFileSystemProvider } from "alepha/system";

import { capacitorTemplates } from "./fixtures.ts";

/**
 * Lay down, in memory, what `alepha capacitor init` leaves on disk: the app's
 * package.json, the installed Capacitor packages, and both native projects
 * with the files the build reads.
 */
export const seedNativeProject = async (
  fs: MemoryFileSystemProvider,
  root: string,
) => {
  await fs.writeFile(`${root}/yarn.lock`, "");
  await fs.writeFile(
    `${root}/package.json`,
    JSON.stringify({
      name: "mobile",
      dependencies: {
        "@capacitor/core": "8.5.2",
        "@capacitor/ios": "8.5.2",
        "@capacitor/android": "8.5.2",
        "@capacitor/haptics": "8.0.2",
        react: "19.3.0",
      },
      devDependencies: { "@capacitor/cli": "8.5.2" },
    }),
  );
  const installed: Record<string, Record<string, unknown>> = {
    "@capacitor/core": { version: "8.5.2" },
    "@capacitor/ios": { version: "8.5.2" },
    "@capacitor/android": { version: "8.5.2" },
    "@capacitor/haptics": { version: "8.0.2", capacitor: { ios: {} } },
    react: { version: "19.3.0" },
  };
  for (const [name, pkg] of Object.entries(installed)) {
    // Hoisted to the workspace root, as Yarn does in this repository.
    await fs.writeFile(
      `/node_modules/${name}/package.json`,
      JSON.stringify({ name, ...pkg }),
    );
  }

  await fs.writeFile(
    `${root}/ios/App/App.xcodeproj/project.pbxproj`,
    "buildSettings = {\n\t\t\t\tCURRENT_PROJECT_VERSION = 1;\n};\nbuildSettings = {\n\t\t\t\tCURRENT_PROJECT_VERSION = 1;\n};\n",
  );
  await fs.writeFile(
    `${root}/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`,
    '{"pins":[]}',
  );
  await fs.writeFile(`${root}/ios/App/App/AppDelegate.swift`, "import UIKit");
  await fs.writeFile(
    `${root}/ios/App/App/Info.plist`,
    capacitorTemplates.infoPlist,
  );
  await fs.writeFile(
    `${root}/ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`,
    "{}",
  );
  await fs.writeFile(`${root}/ios/App/App/public/index.html`, "<html>");

  await fs.writeFile(
    `${root}/android/app/build.gradle`,
    "android {\n    defaultConfig {\n        versionCode 1\n    }\n}\n",
  );
  await fs.writeFile(`${root}/android/build.gradle`, "buildscript {}");
  await fs.writeFile(
    `${root}/android/app/src/main/AndroidManifest.xml`,
    capacitorTemplates.androidManifest,
  );
  await fs.writeFile(
    `${root}/android/app/src/main/java/dev/alepha/mobile/MainActivity.java`,
    "class MainActivity {}",
  );
  await fs.writeFile(
    `${root}/android/app/src/main/res/mipmap-hdpi/ic_launcher.png`,
    "png",
  );
  await fs.writeFile(
    `${root}/android/app/build/intermediates/whatever.bin`,
    "build product",
  );
};
