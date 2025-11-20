#!/usr/bin/env node

import { existsSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Generate tsconfig.json for each module to prevent self-imports
function generateModuleTsconfigs() {
  // Alepha package modules
  const alephaModules = [
    "api-files",
    "api-jobs",
    "api-notifications",
    "api-parameters",
    "api-users",
    "api-verifications",
    "api-workflows",
    "batch",
    "bucket",
    "cache",
    "cache-redis",
    "cli",
    "command",
    "core",
    "datetime",
    "email",
    "fake",
    "file",
    "lock",
    "lock-redis",
    "logger",
    "orm",
    "queue",
    "queue-redis",
    "redis",
    "retry",
    "router",
    "scheduler",
    "security",
    "server",
    "server-cache",
    "server-compress",
    "server-cookies",
    "server-cors",
    "server-health",
    "server-helmet",
    "server-links",
    "server-metrics",
    "server-multipart",
    "server-proxy",
    "server-rate-limit",
    "server-security",
    "server-static",
    "server-swagger",
    "sms",
    "thread",
    "topic",
    "topic-redis",
    "vite",
    "websocket",
  ];

  // React package modules
  const reactModules = ["auth", "core", "form", "head", "i18n", "websocket"];

  // Generate for alepha package modules
  for (const module of alephaModules) {
    const modulePath = join(__dirname, "../packages/alepha/src", module);
    const tsconfigPath = join(modulePath, "tsconfig.json");

    // Special handling for core module which maps to "alepha"
    const paths =
      module === "core"
        ? {
            "alepha/*": [],
            alepha: [],
          }
        : {
            [`alepha/${module}/*`]: [],
          };

    const tsconfig = {
      extends: "../../tsconfig.json",
      compilerOptions: {
        paths,
      },
    };

    // Check if directory exists
    if (!existsSync(modulePath)) {
      console.warn(`⚠️  Directory does not exist: ${modulePath}`);
      continue;
    }

    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
    console.log(
      `✅ Created ${tsconfigPath.replace(join(__dirname, "../"), "")}`,
    );
  }

  // Generate for react package modules
  for (const module of reactModules) {
    const modulePath = join(__dirname, "../packages/react/src", module);
    const tsconfigPath = join(modulePath, "tsconfig.json");

    // React modules use @alepha/react namespace
    const paths = {
      [`@alepha/react/${module}/*`]: [],
    };

    const tsconfig = {
      extends: "../../tsconfig.json",
      compilerOptions: {
        paths,
      },
    };

    // Check if directory exists
    if (!existsSync(modulePath)) {
      console.warn(`⚠️  Directory does not exist: ${modulePath}`);
      continue;
    }

    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
    console.log(
      `✅ Created ${tsconfigPath.replace(join(__dirname, "../"), "")}`,
    );
  }

  console.log("\n✨ Module tsconfig files generated successfully!");
  console.log(
    "\n📝 These files prevent self-imports within each module while allowing cross-module imports.",
  );
  console.log(
    "   WebStorm will respect these settings for auto-import suggestions.",
  );
}

// Run the script
generateModuleTsconfigs();
