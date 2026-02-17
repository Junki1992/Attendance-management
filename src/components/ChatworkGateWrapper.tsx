"use client";

import { useAuth } from "@/context/AuthContext";
import ChatworkRegisterGate from "./ChatworkRegisterGate";

/**
 * ログイン済みかつ Google ログインで Chatwork ID 未設定のときだけ
 * ChatworkRegisterGate を表示し、それ以外は children を表示する。
 */
export default function ChatworkGateWrapper({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const needsChatwork =
    user &&
    user.isGoogleUser &&
    !String(user.chatworkAccountId ?? "").trim();

  if (needsChatwork) {
    return <ChatworkRegisterGate />;
  }
  return <>{children}</>;
}
