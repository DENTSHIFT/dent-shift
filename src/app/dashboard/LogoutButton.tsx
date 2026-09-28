"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 2026-09-29修正(PO指示): クリックしてもPOST完了まで一切の視覚的反応が無く、
 * 「1秒以上無反応に見える」UX課題として指摘された。ログイン/無料診断フォーム等
 * 既存の他ボタンと同じパターン(disabled化 + ローディング文言 + 連打防止フラグ)を適用する。
 */
export function LogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const inFlight = useRef(false);

  async function handleLogout() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      // 遷移後もこのコンポーネント自体はしばらく残り得るため、連打防止フラグと
      // ローディング表示は明示的に解除する(戻る操作等でローディング状態が
      // 残り続けないようにするため)。
      inFlight.current = false;
      setLoggingOut(false);
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loggingOut}
      style={{
        background: "none",
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "6px 12px",
        fontSize: 13,
        cursor: loggingOut ? "not-allowed" : "pointer",
        opacity: loggingOut ? 0.6 : 1,
      }}
    >
      {loggingOut ? "ログアウトしています…" : "ログアウト"}
    </button>
  );
}
