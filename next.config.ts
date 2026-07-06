import type { NextConfig } from "next";

function cspImageSourceFromDomain(domain: string | undefined) {
  if (!domain) return "";
  const withScheme = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return "";
  }
}

const qiniuImageSource = cspImageSourceFromDomain(process.env.QINIU_PRIVATE_DOMAIN);
const imageSources = ["'self'", "data:", "blob:", qiniuImageSource]
  .filter(Boolean)
  .join(" ");

const nextConfig: NextConfig = {
  output: "standalone",

  // Allow the 300MB project file batch upload plus multipart overhead through the proxy.
  experimental: {
    proxyClientMaxBodySize: "400mb",
  },
  serverExternalPackages: [
    "pdfjs-dist",
    "@napi-rs/canvas",
    "pdfkit",
    "adm-zip",
    "fonteditor-core",
  ],
  // Turbopack root fix
  turbopack: {
    root: process.cwd(),
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src ${imageSources}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`,
          },
        ],
      },
    ];
  },

  // Redirect HTTP to HTTPS in production
  // (handled by reverse proxy in deployment)
};

export default nextConfig;
