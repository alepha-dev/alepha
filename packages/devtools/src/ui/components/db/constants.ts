// Provider colors
export const PROVIDER_COLORS: Record<string, string> = {
  PostgresProvider: "#336791",
  SqliteProvider: "#003B57",
  DatabaseProvider: "#495057",
  default: "#495057",
};

export const getProviderColor = (provider: string): string => {
  return PROVIDER_COLORS[provider] ?? PROVIDER_COLORS.default;
};
