"use client";

import { useRouter } from "next/navigation";
import styles from "../ops.module.css";

export function OpsLogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/ops/auth/logout", { method: "POST" });
    router.push("/ops/login");
    router.refresh();
  }

  return (
    <button className={styles.logoutButton} type="button" onClick={handleLogout}>
      ログアウト
    </button>
  );
}
