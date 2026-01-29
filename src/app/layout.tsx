import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '勤怠管理ツール',
  description: 'Premium Shift Management System',
}

import { AuthProvider } from "@/context/AuthContext";
import LabelFix from "@/components/LabelFix";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        {/* FontAwesome CDN (free) */}
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
          crossOrigin="anonymous"
        />
        {/* Inline fallback script to ensure label replacement occurs before/during hydration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var map=[["スタッフ用","アルバイト用"],["スタッフ","アルバイト"]];function replaceNode(n){if(n.nodeType===3){var t=n.nodeValue,orig=t;map.forEach(function(m){t=t.split(m[0]).join(m[1])});if(t!==orig)n.nodeValue=t;}else if(n.nodeType===1){if(n.tagName!=="SCRIPT"&&n.tagName!=="STYLE"){for(var i=0;i<n.childNodes.length;i++){replaceNode(n.childNodes[i])}}}}document.addEventListener?document.addEventListener('DOMContentLoaded',function(){try{replaceNode(document.body)}catch(e){}},false):setTimeout(function(){try{replaceNode(document.body)}catch(e){}},50);var mo=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes&&m.addedNodes.forEach(function(n){try{replaceNode(n)}catch(e){}});if(m.type==='characterData'){try{replaceNode(m.target)}catch(e){}}})});try{mo.observe(document.body,{childList:true,subtree:true,characterData:true});setTimeout(function(){mo.disconnect()},120000);}catch(e){} }catch(e){} })();`,
          }}
        />
      </head>
      <body suppressHydrationWarning={true}>
        <AuthProvider>
          <LabelFix />
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
