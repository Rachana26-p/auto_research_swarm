import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://autoresearchswarm.com";
  const now = new Date();

  const routes = [
    "",
    "/dashboard",
    "/reviews",
    "/knowledge",
    "/guardrails",
    "/privacy",
    "/terms",
    "/auth/login",
    "/auth/register",
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: now,
    changeFrequency: route === "" || route === "/reviews" ? "always" : "daily",
    priority: route === "" ? 1.0 : route.startsWith("/auth") ? 0.4 : 0.8,
  }));
}
