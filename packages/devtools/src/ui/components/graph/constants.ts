export const MODULE_COLORS: Record<string, string> = {
  "alepha.core": "#868e96",
  "alepha.server": "#228be6",
  "alepha.security": "#fa5252",
  "alepha.orm": "#40c057",
  "alepha.cache": "#fab005",
  "alepha.queue": "#fd7e14",
  "alepha.topic": "#be4bdb",
  "alepha.bucket": "#15aabf",
  "alepha.scheduler": "#e64980",
  "alepha.logger": "#74c0fc",
  "alepha.devtools": "#845ef7",
};

export const DEFAULT_MODULE_COLOR = "#495057";

export const getModuleColor = (module?: string): string => {
  if (!module) return DEFAULT_MODULE_COLOR;

  // Check for exact match first
  if (MODULE_COLORS[module]) return MODULE_COLORS[module];

  // Check for prefix match (e.g., "alepha.core.something" -> "alepha.core")
  for (const [key, color] of Object.entries(MODULE_COLORS)) {
    if (module.startsWith(key)) return color;
  }

  // Generate consistent color from module name
  let hash = 0;
  for (let i = 0; i < module.length; i++) {
    hash = module.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 60%, 50%)`;
};
