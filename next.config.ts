import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export', // Firebase Hosting 用に静的エクスポート
  trailingSlash: true, // Firebase Hosting のルーティング互換性のため
};

export default nextConfig;
