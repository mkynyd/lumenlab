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
// 视频/音频不受 img-src 覆盖，缺 media-src 会回落到 default-src 'self'，
// 导致上传中的附件本地 blob 预览被拦。已持久化的媒体走同源鉴权路由，'self' 即可。
const mediaSources = ["'self'", "blob:"].join(" ");
const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  process.env.NODE_ENV === "development" ? "'unsafe-eval'" : "",
]
  .filter(Boolean)
  .join(" ");
const buildWorkerCount = Number.parseInt(process.env.NEXT_BUILD_CPUS ?? "", 10);

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // CI and the local release gate run `tsc --noEmit`; low-memory deploy hosts
  // skip only Next's duplicate build-time check through an explicit env flag.
  typescript: {
    ignoreBuildErrors: process.env.NEXT_DEPLOY_SKIP_TYPECHECK === "1",
  },

  // Allow the 300MB project file batch upload plus multipart overhead through the proxy.
  experimental: {
    proxyClientMaxBodySize: "400mb",
    ...(buildWorkerCount > 0 ? { cpus: buildWorkerCount } : {}),
  },
  serverExternalPackages: [
    "@napi-rs/canvas",
    "pdfkit",
    "adm-zip",
    "fonteditor-core",
    "tencentcloud-sdk-nodejs-ses",
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
              `default-src 'self'; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src ${imageSources}; media-src ${mediaSources}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`,
          },
        ],
      },
      {
        // 原件预览要靠同源 iframe 内嵌（PDF / 文本），而上面那条 `DENY` +
        // `frame-ancestors 'none'` 会把响应本身也拒掉，预览就是一片空白。
        // 这里只针对原件读取放宽到同源，其余路由仍然禁止被任何来源嵌套。
        source: "/api/files/:id/content",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },

  // Redirect HTTP to HTTPS in production
  // (handled by reverse proxy in deployment)
};

export default nextConfig;
