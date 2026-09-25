/** @type {import('next').NextConfig} */
const nextConfig = {
  // Blizzard media (character portraits) are served from specific CDNs;
  // we proxy images through /api or use plain <img>, so no remotePatterns needed.
  output: 'standalone',
};

export default nextConfig;
