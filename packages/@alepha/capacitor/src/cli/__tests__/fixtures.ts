/**
 * The native files the plugin edits, as `cap add` writes them with
 * Capacitor 8.5.2 (trimmed to the parts that matter).
 */
export const capacitorTemplates = {
  infoPlist: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>Mobile</string>
	<key>UIViewControllerBasedStatusBarAppearance</key>
	<true/>
</dict>
</plist>
`,
  pbxproj: `// !$*UTF8*$!
{
	objects = {
		504EC3171FED79650016851F /* Debug */ = {
			buildSettings = {
				CURRENT_PROJECT_VERSION = 1;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = dev.alepha.mobile;
				PRODUCT_NAME = "$(TARGET_NAME)";
			};
		};
		504EC3181FED79650016851F /* Release */ = {
			buildSettings = {
				CURRENT_PROJECT_VERSION = 1;
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = dev.alepha.mobile;
				PRODUCT_NAME = "$(TARGET_NAME)";
			};
		};
	};
}
`,
  appBuildGradle: `apply plugin: 'com.android.application'

android {
    namespace = "dev.alepha.mobile"
    defaultConfig {
        applicationId "dev.alepha.mobile"
        versionCode 1
        versionName "1.0"
    }
}
`,
  stringsXml: `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">Mobile</string>
    <string name="title_activity_main">Mobile</string>
    <string name="package_name">dev.alepha.mobile</string>
    <string name="custom_url_scheme">dev.alepha.mobile</string>
</resources>
`,
  androidManifest: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>
    </application>

    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`,
};
