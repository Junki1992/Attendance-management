import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '勤怠管理ツール',
  description: 'Premium Shift Management System',
}

import { AuthProvider } from "@/context/AuthContext";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body suppressHydrationWarning={true}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
