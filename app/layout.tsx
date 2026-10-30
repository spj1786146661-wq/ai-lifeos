import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import {
  isPersonalAlphaByokHost,
  PERSONAL_ALPHA_BYOK_ENV,
  PERSONAL_ALPHA_BYOK_HOST_ENV,
} from '@/lib/lan-access'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI人生数据库',
  description: 'AI记录人生，AI改变人生。记录运动、睡眠、学习、消费与心情，回看自己的变化。',
  keywords: ['AI人生数据库', '生活记录', '运动', '睡眠', '学习', '消费', '心情'],
  authors: [{ name: 'LifeTracker' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'AI人生数据库',
  },
  openGraph: {
    title: 'AI人生数据库',
    description: 'AI记录人生，AI改变人生。',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#14b8a6' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers()
  const nonce = requestHeaders.get('x-aios-csp-nonce') ?? undefined
  const personalAlphaByok = isPersonalAlphaByokHost(
    requestHeaders.get('host'),
    process.env[PERSONAL_ALPHA_BYOK_ENV],
    process.env[PERSONAL_ALPHA_BYOK_HOST_ENV],
  )
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script nonce={nonce} dangerouslySetInnerHTML={{
          __html: `
            try {
              var saved = localStorage.getItem('darkMode');
              var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              if (saved === 'true' || (saved === null && prefersDark)) {
                document.documentElement.classList.add('dark');
              }
            } catch(e) {}
          `
        }} />
      </head>
      <body
        className="antialiased"
        data-aios-personal-alpha-byok={personalAlphaByok ? 'true' : 'false'}
      >
        {children}
      </body>
    </html>
  )
}
