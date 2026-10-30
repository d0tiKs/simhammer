import path from 'path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve once at build time, so deployed clients identify the bundled code.
let buildCommit = process.env.BUILD_COMMIT || process.env.GITHUB_SHA || '';
if (!buildCommit) {
  try {
    buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Source archives and Docker contexts may not contain Git metadata.
  }
}
buildCommit = /^[a-f0-9]{40,64}$/i.test(buildCommit) ? buildCommit : '';

// VIEWER_BUILD=1: static share viewer served by simhammer.com under /viewer.
const viewer = !!process.env.VIEWER_BUILD;
const staticExport = !!process.env.DESKTOP_BUILD || viewer;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: staticExport ? "export" : "standalone",
  ...(viewer ? { basePath: "/viewer" } : {}),
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
    NEXT_PUBLIC_API_URL: viewer ? "" : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"),
    NEXT_PUBLIC_VIEWER_BUILD: viewer ? "1" : "",
  },
  async rewrites() {
    // In dev, the renderer loads from the Next dev server (localhost:3000) but
    // the backend runs separately. Forward /api/* to the backend so the renderer
    // can use window.location.origin uniformly across dev and production.
    // Skipped for the static export (DESKTOP_BUILD=1) — rewrites aren't supported
    // there, and production has the backend serving the frontend itself.
    if (staticExport) return [];
    const target = process.env.NEXT_PUBLIC_DEV_BACKEND ?? "http://127.0.0.1:17384";
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      // /health lives at the root, not under /api/ — used by the settings page
      // to discover available CPU thread count.
      { source: "/health", destination: `${target}/health` },
    ];
  },
  images: {
    unoptimized: staticExport,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "render.worldofwarcraft.com",
        pathname: "/icons/**",
      },
    ],
  },
};

export default nextConfig;
