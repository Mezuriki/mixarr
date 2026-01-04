/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mixarr/shared-types', '@mixarr/ui'],
  output: 'standalone',
  // Disable build-time font optimization to prevent timeouts in slow CI builds (ARM64 emulation)
  // Fonts will still work correctly but will be fetched at runtime from Google instead of being inlined
  optimizeFonts: process.env.CI !== 'true',
  async rewrites() {
    // API_URL is set at runtime in Docker, defaults to localhost for local dev
    const apiUrl = process.env.API_URL || 'http://localhost:3005';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
