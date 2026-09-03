"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        background: "none",
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "6px 12px",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      ログアウト
    </button>
  );
}
