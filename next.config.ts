import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName =
  process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "tetstar-rule-lab";
const basePath = isGitHubPages ? `/${repositoryName}` : "";

const nextConfig: NextConfig = isGitHubPages
  ? {
      output: "export",
      basePath,
      assetPrefix: basePath,
      trailingSlash: true,
      images: { unoptimized: true },
      turbopack: { root: process.cwd() },
    }
  : {
      turbopack: { root: process.cwd() },
    };

export default nextConfig;
