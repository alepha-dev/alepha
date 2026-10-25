/**
 * Retired config paths and the supported way to express each setting.
 */
export const retiredConfigKeys: Readonly<Record<string, string>> = {
  "build.docker": "top-level image",
  "build.target": "alepha build --runtime",
  "image.image":
    "flat image (image.tag, image.args, image.oci and image.labels)",
  services: "plugins",
  "build.runtimes": "build.runtime",
};
