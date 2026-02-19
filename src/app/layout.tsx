import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: "勤怠管理",
  description: 'Premium Shift Management System',
}

import { AuthProvider } from "@/context/AuthContext";
import ChatworkGateWrapper from "@/components/ChatworkGateWrapper";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
        {/* FontAwesome CDN (free) */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body suppressHydrationWarning={true}>
        <AuthProvider>
          <ChatworkGateWrapper>
            {children}
          </ChatworkGateWrapper>
        </AuthProvider>
      </body>
    </html>
  )
}
