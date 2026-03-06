"use client";

/**
 * 以前は Google ログインで Chatwork ID 未設定のユーザーをブロックしていたが、
 * シフト編集・設定などは Chatwork 不要のためブロックを解除。
 * Chatwork ID は通知メンション用。設定画面で登録を促す。
 */
export default function ChatworkGateWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
