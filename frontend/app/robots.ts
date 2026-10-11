import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://autoresearchswarm.com";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/knowledge", "/privacy", "/terms"],
      disallow: ["/api/", "/runs/*"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
