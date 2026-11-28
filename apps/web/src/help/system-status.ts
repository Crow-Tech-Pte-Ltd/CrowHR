import type { SystemStatus } from "@crowhr/core";
import { apiGet } from "../lib/api.ts";

export const systemStatusQuery = {
  queryKey: ["system", "status"] as const,
  queryFn: () => apiGet<SystemStatus>("/api/v1/system/status"),
  refetchInterval: 60_000,
  retry: false,
};
