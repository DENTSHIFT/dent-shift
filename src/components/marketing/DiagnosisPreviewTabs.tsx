"use client";

import { useState } from "react";
import styles from "@/app/page.module.css";

const NAVY = "#0F1B2D";
const BLUE = "#2563EB";

const TABS = [
  { key: "score", label: "診断結果イメージ" },
  { key: "sov", label: "AIで選ばれている割合" },
  { key: "questions", label: "患者質問の勝ち負け" },
  { key: "top3", label: "改善TOP3" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * 2026-09-22最終修正: 従来4つの独立した大型セクション(診断結果イメージ/AI推薦シェア/
 * 患者質問の勝ち負け/改善TOP3)を「診断で分かる4つのこと」としてタブへ集約し、
 * LP全体の縦の長さを削減する。表示イメージバッジはセクションに1つだけ置く。
 */
export function DiagnosisPreviewTabs() {
  const [active, setActive] = useState<TabKey>("score");

  return (
    <div>
      <div className={styles.tabRow} role="tablist" aria-label="診断で分かる4つのこと">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            className={`${styles.tabButton} ${active === tab.key ? styles.tabButtonActive : ""}`}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.mockFrame}>
        <span className={styles.mockLabel}>表示イメージ(サンプル)</span>
        <div style={{ marginTop: 14 }}>
          {active === "score" && <ScorePreview />}
          {active === "sov" && <SharePreview />}
          {active === "questions" && <QuestionsPreview />}
          {active === "top3" && <Top3Preview />}
        </div>
      </div>
    </div>
  );
}

function ScorePreview() {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div
          style={{
            width: 72,
            height: 72,
            flexShrink: 0,
            borderRadius: "50%",
            background: `conic-gradient(${BLUE} 62%, #E5E9F0 0)`,
            display: "grid",
            placeItems: "center",
          }}
        >
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center" }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>62</span>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>AI集患総合スコア(目黒サンプル歯科)</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9CA3AF" }}>/ 100点・評価:改善余地あり</p>
        </div>
      </div>
      <div className={`${styles.cardGrid} ${styles.cardGrid3}`} style={{ marginTop: 16 }}>
        {["AIO", "MEO", "SEO"].map((d, i) => (
          <div key={d} className={styles.card} style={{ padding: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: "#6B7280" }}>{d}</p>
            <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 700, color: NAVY }}>{[70, 55, 60][i]}点</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SharePreview() {
  const rows = [
    { name: "自院(目黒サンプル歯科)", percent: 18, highlight: true },
    { name: "A歯科", percent: 42 },
    { name: "B歯科", percent: 28 },
  ];
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((row) => (
        <div key={row.name} style={{ display: "grid", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 8 }}>
            <span style={{ color: row.highlight ? NAVY : "#6B7280", fontWeight: row.highlight ? 800 : 500, minWidth: 0, overflowWrap: "anywhere" }}>
              {row.name}
            </span>
            <span style={{ color: row.highlight ? BLUE : "#6B7280", fontWeight: 800, flexShrink: 0 }}>{row.percent}%</span>
          </div>
          <div style={{ height: 8, background: "#F0F2F5", borderRadius: 999 }}>
            <div style={{ height: "100%", width: `${row.percent}%`, borderRadius: 999, background: row.highlight ? BLUE : "#CBD5E1" }} />
          </div>
        </div>
      ))}
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6B7280" }}>
        本番の診断結果・ダッシュボードでは、実測データから同じロジックで算出します。測定できていない場合は0%ではなく「算出不可」と表示します。
      </p>
    </div>
  );
}

function QuestionsPreview() {
  const rows = [
    { q: "目黒 インプラント おすすめ", status: "競合優勢" },
    { q: "東京 矯正歯科 おすすめ", status: "自院優勢" },
    { q: "目黒 ホワイトニング 安い", status: "競合優勢" },
  ];
  const statusColor: Record<string, string> = { 自院優勢: "#166534", 競合優勢: "#B91C1C" };
  const statusBg: Record<string, string> = { 自院優勢: "#ECFDF3", 競合優勢: "#FEF2F2" };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((row) => (
        <div
          key={row.q}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            border: "1px solid #EEF1F5",
            borderRadius: 10,
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 13, color: NAVY, overflowWrap: "anywhere", minWidth: 0 }}>{row.q}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: 999,
              color: statusColor[row.status],
              background: statusBg[row.status],
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {row.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function Top3Preview() {
  const tasks = [
    { title: "LLMO:医院情報の不一致を解消", first: "医院名・診療内容・住所の表記をサイトとGBPで統一する" },
    { title: "Web予約導線:まず確認が必要です", first: "予約URLを登録し、次回診断で状態を可視化する" },
  ];
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {tasks.map((task, i) => (
        <div key={task.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: BLUE,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {i + 1}
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: NAVY, overflowWrap: "anywhere" }}>{task.title}</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6B7280", overflowWrap: "anywhere" }}>まずやること:{task.first}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
