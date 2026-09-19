/**
 * 無料診断「解析中」演出画面(2026-09-06のユーザー指示 / 同日追加指示)。
 *
 * 目的: 「入力→即結果」ではなく「入力→診断開始→解析中演出→診断結果」という体験にする。
 * ここで表示する進捗%・ステップ進行・AIカードの状態はいずれもUX表示専用であり、診断スコアや
 * 実際のAPI処理進捗とは一切連動しない(ユーザー指示: 「この数値はUX表示専用であり、診断スコアや
 * 実処理進捗とは混同しないでください」)。実際のPOST /api/diagnosisの成功/失敗はpage.tsx側で
 * 別途管理し、「演出完了 かつ API成功」の両方が揃って初めて結果画面へ遷移する(このコンポーネント
 * 自体は遷移を行わない。呼び出し側にstatus/percentを渡されるだけの表示専用コンポーネント)。
 *
 * P0はmock provider中心のため、「ChatGPTに接続中」「Geminiで検索中」等、実際に外部AIへ
 * 問い合わせているかのような文言は使用しない(ユーザー指示「最重要ルール」と同種の捏造禁止ルール)。
 * AI観点カードの文言はいずれも「参考分析」であることを明示し、完了状態も「DENT SHIFT内部の
 * 参考分析ステップが完了した」意味であり外部サービスへの問い合わせ成功を意味しないことを、
 * 画面下部の免責文言で明示する。
 *
 * 【AIロゴについて】2026-09-06のユーザー追加指示により、ChatGPT/Gemini/Google AIの各カードに
 * 「ロゴ+名称」を表示するよう求められたが、リポジトリ内(public/brand配下)にこれら3社の
 * 公式ブランドロゴ画像は存在しない。さらに同日の追加指示により、各社の公式ロゴ利用の権利・
 * ブランド条件が確定していない現時点では、3カードとも統一のテキスト中心デザインとする方針に
 * 確定した(似せたロゴ・自作ロゴは禁止)。よって各AIプロバイダーは常にテキストのみのラベルで
 * 表示する(将来、公式ロゴの利用条件が整理された場合に備え、AiProviderInfo.logoSrcが設定
 * された場合のみ<img>表示へ切り替わる拡張構造だけは残してあるが、logoSrc未設定時=現状の
 * テキスト表示だけで見た目として完成しているデザインにすること、という指示に従っている)。
 *
 * 【Claudeの扱いについて】2026-09-06の追加指示により、Claude(Anthropic)は本画面(ユーザー
 * 向け解析中画面)には一切表示しない。Claudeはこの医院の診断providerではないため、AI観点
 * カード(ChatGPT/Gemini/Google AI)にも、開発協力クレジット等の別枠表示にも含めない。
 * 将来About/技術情報ページ等を作る場合に、開発支援ツールとして別途記載を検討する(本画面の
 * スコープ外)。現在の診断ロジック(scoring/mockAiProvider)はChatGPT/Gemini/Google AIの
 * 3つのみをAI観点としてモデル化しており、本変更はUIのみでロジックには触れていない。
 */

const NAVY = "#0F1B2D";
const BLUE = "#2563EB";
const BORDER = "#E5E9F0";
const MUTED = "#6B7280";

export interface AnalyzingStep {
  label: string;
  from: number;
  to: number;
}

// 2026-09-06のユーザー指示「表示ステップ案」「■ プログレス表示」の区切りをそのまま使用。
export const ANALYZING_STEPS: AnalyzingStep[] = [
  { label: "医院情報を確認しています", from: 0, to: 15 },
  { label: "AI検索での見え方を分析しています", from: 15, to: 35 },
  { label: "患者質問ごとの推薦状況を確認しています", from: 35, to: 55 },
  { label: "競合医院との差を分析しています", from: 55, to: 70 },
  { label: "改善ポイントを整理しています", from: 70, to: 85 },
  { label: "診断レポートを作成しています", from: 85, to: 100 },
];

export type StepVisualStatus = "pending" | "active" | "done";

interface ProgressBand {
  from: number;
  to: number;
}

export function stepStatusAt(step: ProgressBand, percent: number): StepVisualStatus {
  if (percent >= step.to) return "done";
  if (percent >= step.from) return "active";
  return "pending";
}

/**
 * AI観点分析カード(2026-09-06の追加ユーザー指示)。
 *
 * 「AI検索での見え方を分析しています」ステップ(15〜35%)を、ChatGPT/Gemini/Google AIの
 * 3つの参考観点に細分化して見せる(実際に3社へ同時アクセスしているという意味ではなく、
 * このステップ内で複数のAI観点から参考分析していることを視覚的に伝えるための表示分割)。
 *
 * activeLabelはユーザー指定の文言をそのまま使用する(捏造禁止ルールに基づき、
 * 「〜に接続中」等の表現は使わない)。
 */
export interface AiProviderInfo {
  id: "chatgpt" | "gemini" | "google_ai";
  displayName: string;
  shortLabel: string;
  // 正式ブランドロゴ画像のパス。未取得のため現状は全てnull(上記コメント参照)。
  // 用意でき次第ここへ画像パスを設定すれば、AiProviderCardが自動的に<img>表示へ切り替わる。
  logoSrc: string | null;
  activeLabel: string;
  from: number;
  to: number;
}

// 【重要】現時点でこの配列にClaudeは含めない(2026-09-06のユーザー指示: 「Claudeがこの医院の
// 診断・分析を実行しているようには見せないでください」「ユーザー向け解析中画面には表示しない」)。
// ChatGPT/Gemini/Google AIはP0のscoring/mockAiProvider側で実際にAI観点としてモデル化されて
// いるためカード化しているが、Claudeは診断ロジック上のproviderではない。将来Claudeが正式な
// 診断providerとして実装された場合のみ、この配列へ4件目のAiProviderInfo(displayName: "Claude"
// 等)を追加し、下のpercentレンジ(15〜35%)を4分割し直せば、4枚目のAI観点カードへそのまま
// 昇格できる。
export const AI_PROVIDER_CARDS: AiProviderInfo[] = [
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    shortLabel: "ChatGPT",
    logoSrc: null,
    activeLabel: "ChatGPT観点を参考分析中",
    from: 15,
    to: 21.6667,
  },
  {
    id: "gemini",
    displayName: "Gemini",
    shortLabel: "Gemini",
    logoSrc: null,
    activeLabel: "Gemini観点を参考分析中",
    from: 21.6667,
    to: 28.3333,
  },
  {
    id: "google_ai",
    displayName: "Google AI",
    shortLabel: "Google AI",
    logoSrc: null,
    activeLabel: "Google AI検索観点を参考分析中",
    from: 28.3333,
    to: 35,
  },
];

// 2026-09-06の追加指示: 状態表示は「待機中 / 参考分析中 / 分析完了」の3種類に統一する
// (mock/sample時であることが常に一目で分かるよう、活動中の状態名にも「参考」を含める)。
const AI_CARD_STATUS_BADGE: Record<StepVisualStatus, string> = {
  pending: "待機中",
  active: "参考分析中",
  done: "分析完了",
};

function aiCardDescription(provider: AiProviderInfo, status: StepVisualStatus): string {
  if (status === "done") return `${provider.shortLabel}観点の参考分析が完了しました`;
  if (status === "active") return provider.activeLabel;
  return `${provider.shortLabel}観点の分析は順番待ちです`;
}

export interface AnalyzingScreenProps {
  percent: number;
  apiStatus: "pending" | "success" | "error";
  errorMessage: string | null;
  onRetry: () => void;
}

export function AnalyzingScreen({ percent, apiStatus, errorMessage, onRetry }: AnalyzingScreenProps) {
  const roundedPercent = Math.round(percent);
  // エラー時はそれ以上ステップ・カードを進行させて見せない(呼び出し元がpercent更新自体を
  // 止めるため実質的にstepStatusAtと同じ結果になるが、意図を明示するため分離して呼び出す)。
  const statusAt = (band: ProgressBand) =>
    apiStatus === "error" ? stepStatusAtFrozenForError(band, percent) : stepStatusAt(band, percent);

  return (
    <section
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 24,
        boxShadow: "0 1px 2px rgba(15,27,45,0.04)",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, color: NAVY, fontWeight: 700, textAlign: "center" }}>
        AI集患力を診断しています
      </h1>
      <p style={{ margin: "8px 0 0", fontSize: 13, color: "#374151", textAlign: "center", lineHeight: 1.7 }}>
        医院情報を複数の観点から分析しています。
        <br />
        このまま少しお待ちください。
      </p>

      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: MUTED }}>解析の進み具合(表示用)</span>
          <span style={{ fontSize: 12, color: NAVY, fontWeight: 700 }}>{roundedPercent}%</span>
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 999,
            background: BORDER,
            overflow: "hidden",
          }}
          role="progressbar"
          aria-valuenow={roundedPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.max(2, roundedPercent)}%`,
              background: BLUE,
              borderRadius: 999,
              transition: "width 0.2s linear",
            }}
          />
        </div>
      </div>

      {/* AI観点分析カード(2026-09-06の追加ユーザー指示)。PCでは3枚横並び、モバイルでは
          縦積みにして崩れないようにする(ds-ai-card-gridのCSSをこのコンポーネント内で完結させる)。 */}
      <div className="ds-ai-card-grid" style={{ marginTop: 22 }}>
        {AI_PROVIDER_CARDS.map((provider) => {
          const status = statusAt(provider);
          return <AiProviderCard key={provider.id} provider={provider} status={status} />;
        })}
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 22 }}>
        {ANALYZING_STEPS.map((step) => (
          <StepRow key={step.label} label={step.label} status={statusAt(step)} />
        ))}
      </div>

      {apiStatus === "pending" && roundedPercent >= 100 && (
        <p style={{ margin: "16px 0 0", fontSize: 12, color: MUTED, textAlign: "center" }}>
          結果を確認しています…
        </p>
      )}

      {apiStatus === "error" && (
        <div
          style={{
            marginTop: 20,
            border: "1px solid #FECACA",
            background: "#FEF2F2",
            color: "#991B1B",
            borderRadius: 10,
            padding: "14px 16px",
          }}
        >
          <p style={{ margin: 0, fontSize: 13 }}>
            {errorMessage ?? "診断処理中にエラーが発生しました。時間をおいて再度お試しください。"}
          </p>
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: 12,
              background: BLUE,
              color: "#fff",
              padding: "10px 20px",
              borderRadius: 999,
              border: "none",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            もう一度診断する
          </button>
        </div>
      )}

      {/* 実測と参考データが混在する現在のP0仕様を、provider設定にかかわらず正確に案内する。
          解析中のカードや進捗はUX表示専用であり、個々の取得状況は結果画面で確認してもらう。 */}
      <p style={{ margin: "18px 0 0", fontSize: 11, color: MUTED, textAlign: "center", lineHeight: 1.6 }}>
        現在は開発中の参考分析です。
        <br />
        実測データと参考データが混在する場合があります。取得状況は結果画面でご確認ください。
      </p>

      {/* keyframeはStepIcon(別コンポーネント)のinline styleから名前で参照するため、
          styled-jsxのスコープ付与(クラス名/keyframe名のハッシュ化)を受けない
          `jsx global` を使用する(scoped `<style jsx>` のままだとkeyframe名が
          コンポーネント単位でハッシュ化され、他コンポーネントから参照できなくなる)。 */}
      <style jsx global>{`
        @keyframes ds-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
      `}</style>
      <style jsx>{`
        .ds-ai-card-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        @media (max-width: 560px) {
          .ds-ai-card-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

function stepStatusAtFrozenForError(band: ProgressBand, percent: number): StepVisualStatus {
  return stepStatusAt(band, percent);
}

function AiProviderCard({ provider, status }: { provider: AiProviderInfo; status: StepVisualStatus }) {
  const badgeColor = status === "done" ? "#166534" : status === "active" ? BLUE : "#9CA3AF";
  const badgeBg = status === "done" ? "#F0FDF4" : status === "active" ? "#EFF6FF" : "#F9FAFB";
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "12px 14px",
        background: status === "pending" ? "#FAFBFC" : "#fff",
      }}
    >
      {/* 名前行とステータスバッジ行を縦に分ける(2026-09-06修正: PCで3カード横並びにした際、
          1カードあたりの横幅が狭く、名前+バッジを横並びにすると"ChatGPT"のような短い名称
          すら省略記号で切れてしまっていたため、横幅に左右されず名称が確実に読める縦積み
          レイアウトへ変更した)。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {/* 正式ブランドロゴ未取得のため、ロゴ画像の代わりにテキストのみのラベルを表示する
            (手描き・類似ロゴの作成はしない。logoSrcが設定されればここが<img>に切り替わる)。 */}
        {provider.logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={provider.logoSrc} alt={provider.displayName} style={{ height: 18, flexShrink: 0 }} />
        ) : (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 700,
              color: MUTED,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              padding: "2px 6px",
              background: "#F5F7FA",
            }}
          >
            AI
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 700, color: NAVY, minWidth: 0, overflowWrap: "break-word" }}>
          {provider.displayName}
        </span>
      </div>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          marginTop: 8,
          fontSize: 11,
          fontWeight: 700,
          color: badgeColor,
          background: badgeBg,
          borderRadius: 999,
          padding: "3px 8px",
        }}
      >
        <StepIcon status={status} size={12} />
        {AI_CARD_STATUS_BADGE[status]}
      </span>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 11,
          color: status === "pending" ? "#9CA3AF" : "#374151",
          lineHeight: 1.5,
        }}
      >
        {aiCardDescription(provider, status)}
      </p>
    </div>
  );
}

function StepRow({ label, status }: { label: string; status: StepVisualStatus }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <StepIcon status={status} />
      <span
        style={{
          fontSize: 13,
          color: status === "pending" ? "#9CA3AF" : status === "active" ? NAVY : "#374151",
          fontWeight: status === "active" ? 700 : 400,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function StepIcon({ status, size = 18 }: { status: StepVisualStatus; size?: number }) {
  if (status === "done") {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <circle cx="10" cy="10" r="10" fill={BLUE} />
        <path d="M6 10.5l2.5 2.5L14 7.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "active") {
    return (
      <span
        style={{
          flexShrink: 0,
          width: size,
          height: size,
          borderRadius: "50%",
          border: `2px solid ${BLUE}`,
          background: "#EFF6FF",
          display: "inline-block",
          animation: "ds-pulse 1.1s ease-in-out infinite",
        }}
      />
    );
  }
  return (
    <span
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: "50%",
        border: `1.5px solid ${BORDER}`,
        background: "#fff",
        display: "inline-block",
      }}
    />
  );
}
