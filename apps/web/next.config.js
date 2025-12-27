/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mixarr/shared-types', '@mixarr/ui'],
  output: 'standalone',
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
