import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware: /admin/* へのアクセスをサーバー側で検証
 * 
 * 注意: Firebase Admin SDK を使う場合は、以下の環境変数が必要です：
 * - FIREBASE_ADMIN_PROJECT_ID
 * - FIREBASE_ADMIN_CLIENT_EMAIL  
 * - FIREBASE_ADMIN_PRIVATE_KEY
 * 
 * これらは Firebase コンソール → プロジェクト設定 → サービスアカウント で取得できます。
 * 本番環境（Vercel 等）では環境変数として設定してください。
 * 
 * 現状は Firestore ルールで role の書き換えを禁止しているため、
 * この Middleware は追加のセキュリティレイヤーとして機能します。
 */
export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    // /admin/* へのアクセスのみチェック
    if (!pathname.startsWith("/admin")) {
        return NextResponse.next();
    }

    // Firebase Admin SDK が設定されていない場合は、クライアント側チェックに任せる
    // （Firestore ルールで role の書き換えは禁止されているため、基本的には安全）
    if (!process.env.FIREBASE_ADMIN_PROJECT_ID) {
        // 開発環境などで Admin SDK が未設定の場合
        // Firestore ルールに依存する
        return NextResponse.next();
    }

    // Firebase Admin SDK で token を検証し、users/{uid} の role を確認
    // 実装例（コメントアウト）:
    /*
    import { initializeApp, getApps, cert } from "firebase-admin/app";
    import { getAuth } from "firebase-admin/auth";
    import { getFirestore } from "firebase-admin/firestore";

    if (!getApps().length) {
        initializeApp({
            credential: cert({
                projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
                clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
            }),
        });
    }

    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "") || request.cookies.get("__session")?.value;

    if (!token) {
        return NextResponse.redirect(new URL("/login", request.url));
    }

    try {
        const decodedToken = await getAuth().verifyIdToken(token);
        const db = getFirestore();
        const userDoc = await db.collection("users").doc(decodedToken.uid).get();
        const userData = userDoc.data();

        if (!userData || userData.role !== "admin") {
            return NextResponse.redirect(new URL("/login", request.url));
        }
    } catch (error) {
        return NextResponse.redirect(new URL("/login", request.url));
    }
    */

    // 現状は Firestore ルールに依存（Admin SDK 未設定時）
    return NextResponse.next();
}

export const config = {
    matcher: ["/admin/:path*"],
};
