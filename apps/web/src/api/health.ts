export interface LiveHealth {
  status: string;
  service?: string;
  time?: string;
}

export async function fetchLiveHealth(): Promise<LiveHealth> {
  const response = await fetch("/health/live", { credentials: "include" });
  if (!response.ok) {
    throw new Error("health check failed");
  }
  return (await response.json()) as LiveHealth;
}

export function isLiveOk(payload: LiveHealth | undefined): boolean {
  return payload?.status === "ok";
}
