import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Parent /side-projects/package-lock.json makes Next infer the wrong workspace
// root and watch ~14GB of sibling projects — which OOMs the Node heap.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
