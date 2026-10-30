import type { NextConfig } from 'next'

const publicBetaBuild = Boolean(process.env.AIOS_PUBLIC_BETA_HOSTS?.trim())
const baselineSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  ...(publicBetaBuild
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
]

const nextConfig: NextConfig = {
  // Kept unset in normal use. An isolated dev check can point this at a
  // separate local directory so it never shares .next or its dev lock.
  distDir: process.env.AIOS_DIST_DIR || '.next',
  reactStrictMode: true,
  turbopack: {}, // Next.js 16 uses Turbopack by default
  allowedDevOrigins: process.env.AIOS_ALLOWED_DEV_ORIGIN
    ? [process.env.AIOS_ALLOWED_DEV_ORIGIN]
    : undefined,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: baselineSecurityHeaders,
    }]
  },
}

// PWA: manifest.json in /public enables "Add to Home Screen" on mobile
// Service worker for offline caching can be added later

export default nextConfig
