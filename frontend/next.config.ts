import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: false,
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
  async headers() {
    return [
      {
        source: '/models/:path*.wasm',
        headers: [{ key: 'Content-Type', value: 'application/wasm' }],
      },
      {
        source: '/models/:path*.bin',
        headers: [{ key: 'Content-Type', value: 'application/octet-stream' }],
      },
    ];
  },
};

export default nextConfig;
