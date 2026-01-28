/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mixarr/shared-types', '@mixarr/ui'],
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },           // Spotify CDN
      { protocol: 'https', hostname: 'e-cdns-images.dzcdn.net' }, // Deezer CDN
      { protocol: 'https', hostname: 'coverartarchive.org' },  // MusicBrainz
      { protocol: 'https', hostname: 'archive.org' },          // Archive.org (fallback)
      { protocol: 'https', hostname: 'lastfm.freetls.fastly.net' }, // Last.fm
      { protocol: 'https', hostname: '**.last.fm' },           // Last.fm alternative
    ],
  },
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
