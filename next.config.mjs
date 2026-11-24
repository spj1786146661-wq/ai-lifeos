const publicBetaBuild = Boolean(process.env.AIOS_PUBLIC_BETA_HOSTS?.trim())
// Next.js 16 blocks dev-resource requests (HMR, fonts) whose Origin hostname
// is not in this list. Entries are hostnames without ports, matching how the
// dev server parses the Origin header. The loopback addresses must be listed
// explicitly so the browser client can hydrate when the page is opened via
// 127.0.0.1 (Next.js only auto-allows `localhost` and `**.localhost`).
const localDevOrigins = ['localhost', '127.0.0.1', '[::1]']
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Kept unset in normal use. An isolated dev check can point this at a
  // separate local directory so it never shares .next or its dev lock.
  distDir: process.env.AIOS_DIST_DIR || '.next',
  reactStrictMode: true,
  turbopack: {}, // Next.js 16 uses Turbopack by default
  allowedDevOrigins: process.env.AIOS_ALLOWED_DEV_ORIGIN
    ? [process.env.AIOS_ALLOWED_DEV_ORIGIN]
    : localDevOrigins,
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
