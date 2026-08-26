import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  transpilePackages: ["three"],
  eslint: { ignoreDuringBuilds: true },
  // Keeps the dev overlay badge out of the corner of the dashboard.
  devIndicators: false,
};

export default nextConfig;
