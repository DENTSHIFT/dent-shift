import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // muhammaraはネイティブaddon(node-pre-gyp経由)のため、webpackでバンドルせず
  // サーバー実行時にNodeのrequireへ委譲する(生成PDFのパスワード保護用、Phase4)。
  serverExternalPackages: ["muhammara"],
};

export default nextConfig;
