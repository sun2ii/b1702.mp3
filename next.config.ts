import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export: `next build` writes plain HTML/JS to ./out, which Capacitor bundles into the app.
  // Server features (API routes, server actions) can still exist in this repo later — they just
  // deploy to a server, and the phone calls them over HTTPS.
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
