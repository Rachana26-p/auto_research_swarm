export interface UtmParameters {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  first_touch_timestamp?: string;
  referrer?: string;
}

const STORAGE_KEY = "swarm_utm_params";

export function captureUtmParameters(): UtmParameters {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const utm_source = params.get("utm_source") || undefined;
  const utm_medium = params.get("utm_medium") || undefined;
  const utm_campaign = params.get("utm_campaign") || undefined;
  const utm_term = params.get("utm_term") || undefined;
  const utm_content = params.get("utm_content") || undefined;

  // Only store if at least one UTM param exists
  if (utm_source || utm_medium || utm_campaign || utm_term || utm_content) {
    const data: UtmParameters = {
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      first_touch_timestamp: new Date().toISOString(),
      referrer: document.referrer || undefined,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
    return data;
  }

  // Retrieve stored if available
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}

  return {};
}

export function getStoredUtmParameters(): UtmParameters {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}
