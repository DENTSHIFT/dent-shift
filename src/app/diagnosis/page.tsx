"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FocusEvent, FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnalyzingScreen } from "./AnalyzingScreen";
import { shouldNavigateToResult, type DiagnosisFlowState } from "./diagnosisFlow";
import {
  applyAuthenticatedDiagnosisProfile,
  type AuthenticatedDiagnosisProfile,
  type DiagnosisFormValues,
} from "./diagnosisPrefill";
import type { ClinicDuplicateMatchType } from "@/domain/clinic/duplicateDetection";
import { isValidClinicContactPhone } from "@/domain/clinic/contactPhone";

// DENT SHIFT正式カラー(public/brand/logo/README_使用ガイド.md「正式カラー」節が正本)。
// 結果画面(src/app/diagnosis/result/[id]/page.tsx)と同じ値をこの画面でも使用する。
const NAVY = "#0F1B2D";
const BLUE = "#2563EB";
const BG = "#F5F7FA";
const BORDER = "#E5E9F0";
const MUTED = "#6B7280";
const ERROR = "#DC2626";
// 2026-09-07のユーザー指示: スペシャリストカードのみ、
// design/reference/dashboard/無料相談CTA付きDENT SHIFTダッシュボード.pngの
// プレミアム感を参考にしたmuted gold系アクセント(border/eyebrow/sparkle icon/badge/
// 下部案内)。全面金色にはせず、背景はごく薄いwarm ivoryに留める。他画面には使わない。
const GOLD_BG = "#FBF8EF";
const GOLD_BORDER = "#E4D6A7";
const GOLD_TEXT = "#93762A";
const GOLD_BADGE_BG = "#F6EDD6";
// 2026-09-07のユーザー指示: 「診断でわかること」3カードのみで使う薄いブルー系border。
// styled-jsxのcomponent scope問題(SpecialistCardと同一原因)によりInsightCard自身が
// className経由でスタイルを受け取れなかったため、InsightCardもinline style化する。
const INSIGHT_CARD_BORDER = "#DCE7FB";

type FieldName = keyof DiagnosisFormValues;

interface DuplicateCandidateNotice {
  matchType: ClinicDuplicateMatchType;
  message: string;
}

// UIのみの入力チェック(2026-09-06のユーザー指示: 十分な入力UI(error state含む)を持たせる)。
// 診断ロジック・API側のバリデーション(runFreeDiagnosis.ts)は変更しない。ここはあくまで
// 送信前に院長へ分かりやすい日本語でフィードバックするための表示専用ロジック。
function validateField(name: FieldName, value: string): string | null {
  const trimmed = value.trim();
  switch (name) {
    case "clinicName":
      return trimmed ? null : "医院名を入力してください";
    case "clinicUrl":
      if (!trimmed) return "公式サイトURLを入力してください";
      if (!/^https?:\/\/.+/.test(trimmed)) return "http(s)://から始まるURLを入力してください";
      return null;
    case "contactEmail":
      if (!trimmed) return "メールアドレスを入力してください";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "正しいメールアドレスの形式で入力してください";
      return null;
    case "contactPhone":
      if (!trimmed) return "電話番号を入力してください";
      if (!isValidClinicContactPhone(trimmed)) return "国内の電話番号を10〜11桁で入力してください";
      return null;
    case "gbpUrl":
    case "bookingUrl":
      if (!trimmed) return null;
      if (!/^https?:\/\/.+/.test(trimmed)) return "http(s)://から始まるURLを入力してください";
      return null;
    default:
      return null;
  }
}

// 解析演出の合計時間(ms)。2026-09-06のユーザー指示「最低12秒にしてください。APIが500msで
// 終わっても12秒未満では結果へ遷移しないこと。逆にAPIが12秒以上かかった場合はAPI完了まで
// 待つこと」に対応する「最低表示時間」。実際の遷移可否はdiagnosisFlow.tsのshouldNavigateToResult
// が判定する(analysisCompleted && apiCompleted の両方が必要)。
const ANALYZING_DURATION_MS = 12000;

export default function DiagnosisPage() {
  const router = useRouter();
  const [values, setValues] = useState<DiagnosisFormValues>({
    clinicName: "",
    clinicUrl: "",
    contactEmail: "",
    contactPhone: "",
    gbpUrl: "",
    bookingUrl: "",
  });
  const [authenticatedProfile, setAuthenticatedProfile] =
    useState<AuthenticatedDiagnosisProfile | null>(null);
  const [duplicateCandidate, setDuplicateCandidate] =
    useState<DuplicateCandidateNotice | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // 解析中演出の状態(2026-09-06 / 追加ユーザー指示: 実Macで「解析中画面がほぼ表示されず
  // 即時遷移する」問題への対応として、状態を明確な3つの独立フラグへ分離する)。
  // - flowState: "form" | "analyzing" | "error" (ユーザー指示の型をそのまま採用)
  // - analysisCompleted: 最低表示時間(ANALYZING_DURATION_MS)が経過したか(UX表示専用)
  // - apiCompleted: POST /api/diagnosisが成功し、diagnosisIdを取得できたか
  // 結果画面への遷移可否は、この3つの状態から純粋関数shouldNavigateToResult()が判定し、
  // router.push呼び出しはファイル内でuseEffect 1箇所のみに限定する
  // (ユーザー指示: 「page.tsxのsubmit handlerからAPI成功直後に直接router.pushしてはいけない」
  // 「遷移を行う場所は1箇所だけに統一する」)。
  const [flowState, setFlowState] = useState<DiagnosisFlowState>("form");
  const [percent, setPercent] = useState(0);
  const [analysisCompleted, setAnalysisCompleted] = useState(false);
  const [apiCompleted, setApiCompleted] = useState(false);
  const [apiErrorMessage, setApiErrorMessage] = useState<string | null>(null);
  const [diagnosisId, setDiagnosisId] = useState<string | null>(null);

  const rafRef = useRef<number | null>(null);
  // submit/retryのたびに増分するリクエスト世代番号。古い(キャンセル済み)fetchの結果が
  // 後から解決しても、現在の世代と一致しない場合はstateを更新しない(2重送信・連打対策)。
  const requestGenerationRef = useRef(0);
  const allowDuplicateClinicRef = useRef(false);

  // ダッシュボードから再診断する場合は、ログイン中の医院情報を自動入力する。
  // 未ログイン(401)や一時的な取得失敗では従来の空フォームをそのまま利用できる。
  useEffect(() => {
    let active = true;

    async function loadAuthenticatedProfile() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (!response.ok) return;
        const profile = (await response.json()) as AuthenticatedDiagnosisProfile;
        if (!active || profile.authenticated !== true) return;
        setValues((current) => applyAuthenticatedDiagnosisProfile(current, profile));
        setAuthenticatedProfile(profile);
        setDuplicateCandidate(null);
      } catch {
        // 自動入力は補助機能。失敗しても匿名診断フォームの利用は妨げない。
      }
    }

    void loadAuthenticatedProfile();
    return () => {
      active = false;
    };
  }, []);

  function fieldError(name: FieldName): string | null {
    if (!touched[name] && !submitAttempted) return null;
    return validateField(name, values[name]);
  }

  function handleChange(name: FieldName) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      setValues((prev) => ({ ...prev, [name]: e.target.value }));
      if (name === "clinicName" || name === "clinicUrl") {
        allowDuplicateClinicRef.current = false;
        setDuplicateCandidate(null);
      }
    };
  }

  function handleBlur(name: FieldName) {
    return () => {
      setTouched((prev) => ({ ...prev, [name]: true }));
    };
  }

  // 実際のAPI呼び出し(診断ロジック・エンドポイント自体は変更しない。従来と同じ
  // /api/diagnosisへ同じフィールドをPOSTするだけ)。ここではapiCompleted/diagnosisId/
  // flowStateの更新のみを行い、router.push は一切呼ばない(遷移は下のuseEffectに一本化)。
  async function submitDiagnosis(generation: number) {
    try {
      const res = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          allowDuplicateClinic: allowDuplicateClinicRef.current,
        }),
      });
      const data = await res.json();
      if (requestGenerationRef.current !== generation) return; // 古いリクエストの結果は無視
      if (!res.ok) {
        if (res.status === 409 && data.code === "clinic_duplicate_candidate") {
          setDuplicateCandidate({ matchType: data.matchType, message: data.error });
          setPercent(0);
          setAnalysisCompleted(false);
          setApiCompleted(false);
          setApiErrorMessage(null);
          setFlowState("form");
          return;
        }
        setApiErrorMessage(data.error ?? "診断に失敗しました");
        setFlowState("error");
        return;
      }
      setDiagnosisId(data.diagnosisId);
      setApiCompleted(true);
    } catch {
      if (requestGenerationRef.current !== generation) return;
      setApiErrorMessage("通信エラーが発生しました。時間をおいて再度お試しください。");
      setFlowState("error");
    }
  }

  // 解析中フェーズに入ったら、最低表示時間の進捗アニメーションとAPI呼び出しを同時に開始する。
  useEffect(() => {
    if (flowState !== "analyzing") return;
    const generation = requestGenerationRef.current;
    const startedAt = performance.now();

    function tick(now: number) {
      if (requestGenerationRef.current !== generation) return; // retry等で世代が進んだら停止
      const elapsed = now - startedAt;
      const next = Math.min(100, (elapsed / ANALYZING_DURATION_MS) * 100);
      setPercent(next);
      if (next >= 100) {
        setAnalysisCompleted(true);
        rafRef.current = null;
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    void submitDiagnosis(generation);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowState]);

  // 結果画面への遷移は、このuseEffect 1箇所からのみ行う(ファイル内でrouter.pushはここだけ)。
  // 条件判定はReactに依存しない純粋関数shouldNavigateToResult()に委譲し、
  // 「最低表示時間の経過(analysisCompleted)」と「API成功+診断ID取得(apiCompleted+
  // diagnosisId)」の両方が揃うまで、どれだけAPIが速く終わっても遷移しない。
  useEffect(() => {
    if (shouldNavigateToResult({ flowState, analysisCompleted, apiCompleted, diagnosisId })) {
      router.push(`/diagnosis/result/${diagnosisId}`);
    }
  }, [flowState, analysisCompleted, apiCompleted, diagnosisId, router]);

  function startAnalysis(allowDuplicateClinic: boolean) {
    allowDuplicateClinicRef.current = allowDuplicateClinic;
    requestGenerationRef.current += 1;
    setPercent(0);
    setAnalysisCompleted(false);
    setApiCompleted(false);
    setApiErrorMessage(null);
    setDiagnosisId(null);
    setFlowState("analyzing");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);

    const allFields: FieldName[] = [
      "clinicName",
      "clinicUrl",
      "contactEmail",
      "contactPhone",
      "gbpUrl",
      "bookingUrl",
    ];
    const hasError = allFields.some((name) => validateField(name, values[name]) !== null);
    if (hasError) return;

    // 解析開始前に候補を案内する。診断APIも同じ検査を再実行するため、
    // 事前確認後に別リクエストでClinicが増えても勝手な統合は起きない。
    setCheckingDuplicate(true);
    try {
      const response = await fetch("/api/clinics/duplicate-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicName: values.clinicName, clinicUrl: values.clinicUrl }),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          duplicateCandidate: DuplicateCandidateNotice | null;
        };
        if (data.duplicateCandidate) {
          setDuplicateCandidate(data.duplicateCandidate);
          return;
        }
      }
    } catch {
      // 補助的な事前確認。診断API側の再検査が最終防御になる。
    } finally {
      setCheckingDuplicate(false);
    }

    setDuplicateCandidate(null);
    startAnalysis(false);
  }

  function handleContinueDuplicate() {
    setDuplicateCandidate(null);
    startAnalysis(true);
  }

  function handleRetry() {
    requestGenerationRef.current += 1; // 進行中のfetch/rAFの結果を無効化する
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setFlowState("form");
    setPercent(0);
    setAnalysisCompleted(false);
    setApiCompleted(false);
    setApiErrorMessage(null);
    setDiagnosisId(null);
    allowDuplicateClinicRef.current = false;
  }

  // 解析中フェーズ(2026-09-06のユーザー指示: 「小さい中央カードだけではなく、
  // viewport全体を使った専用画面にしてください」)。入力フォームの狭い560px幅の
  // カード内に収めるのではなく、min-height:100vhでページ全体を占有し、その中央に
  // 正式ロゴ・進捗・ステップを配置する専用レイアウトへ切り替える。
  // flowState==="error"の間もこのレイアウトのまま(AnalyzingScreen内でエラー状態を表示する。
  // ユーザー指示: 「POST失敗→結果画面へ遷移禁止→analyzing画面内でerror state」)。
  if (flowState === "analyzing" || flowState === "error") {
    return (
      <main
        style={{
          background: BG,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 20px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 640 }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
              alt="DENT SHIFT 歯科集患を、AIでシフトする。"
              style={{ height: 36 }}
            />
          </div>
          <AnalyzingScreen
            percent={percent}
            apiStatus={flowState === "error" ? "error" : apiCompleted ? "success" : "pending"}
            errorMessage={apiErrorMessage}
            onRetry={handleRetry}
          />
        </div>
      </main>
    );
  }

  // 2026-09-07のユーザー指示: PCでは画面中央の細い1カラムカード(旧: maxWidth 560の
  // 申込フォーム感)を廃止し、左(価値訴求)/右(フォーム)のワイド2カラム構成にする。
  // 診断ロジック・API・バリデーション仕様(handleSubmit以下)は一切変更せず、
  // 見た目(JSX構造とスタイル)のみを変更する。モバイル(768px未満)は
  // ロゴ→見出し→メインコピー→安心要素→フォーム→CTAの1カラム順に自然と積み上がるよう、
  // DOM順序をそのまま踏襲し、CSS Gridの列指定はデスクトップ幅でのみ有効にする
  // (横スクロールが絶対に発生しないよう、モバイル基準では常にgrid-template-columns:1fr)。
  return (
    <main style={{ background: BG, minHeight: "100vh", paddingBottom: 64 }}>
      <div className="ds-shell">
        <div className="ds-left">
          <header className="ds-left-logo">
            {/* ロゴは正本(public/brand/logo)をそのまま使用。変形・再配色はしない
                (DESIGN_SYSTEM.md「ロゴ」節の禁止事項)。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
              alt="DENT SHIFT 歯科集患を、AIでシフトする。"
            />
          </header>

          <div className="ds-left-content">
            {/* 2.「歯科医院専用AI集患OS」(2026-09-07のユーザー指示: 左カラム最終構成) */}
            <p className="ds-eyebrow">歯科医院専用AI集患OS</p>

            {/* 3. 見出し */}
            <h1 className="ds-heading">無料AI集患診断</h1>

            {/* 4. メインコピー */}
            <p className="ds-main-copy">
              AIにあなたの医院がどう見えているか。
              <br />
              競合との差と改善余地を約60秒で診断します。
            </p>

            {/* 5. 診断でわかること3カード(2026-09-07のユーザー指示。従来の補足3行を
                「AIでの見え方/競合との差/改善TOP3」の3カードへ置き換える) */}
            <div className="ds-insight-grid">
              <InsightCard
                icon="eye"
                title="AIでの見え方"
                description="自院がAIに認識・推薦されているか"
              />
              <InsightCard
                icon="compare"
                title="競合との差"
                description="患者質問ごとのAI表示状況"
              />
              <InsightCard
                icon="trend"
                title="改善TOP3"
                description="次に何を直すべきか"
              />
            </div>
          </div>

          {/* 6. 安心材料(2026-09-06のユーザー指示: PC幅で3+1の中途半端な折り返しを避け、
              常に2列×2行で左右・上下を揃える。gridTemplateColumnsを"1fr 1fr"に固定し、
              auto-fitによる列数の可変を止める) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            <Reassurance text="約60秒で診断" />
            <Reassurance text="営業電話なし" />
            <Reassurance text="クレジットカード不要" />
            <Reassurance text="まず診断結果だけ確認" />
          </div>

          {/* 7. スペシャリスト安心カード(2026-09-07のユーザー指示: 「診断後のサポートがある
              安心感」を伝える小さめの安心カード。主役はあくまで無料AI集患診断のため、
              フォーム/CTAより弱いトーンで、安心要素の直後・フォームの直前に配置する) */}
          <SpecialistCard />
        </div>

        <div className="ds-right">
          <section className="ds-form-card">
            {authenticatedProfile && (
              <div className="ds-signed-in-notice" role="status">
                <strong>{authenticatedProfile.clinicName}</strong> の登録情報を使用します。
                診断結果はダッシュボードの履歴へ追加されます。
              </div>
            )}
            <form onSubmit={handleSubmit} noValidate>
              {/* 5. 必須入力 */}
              <div style={{ display: "grid", gap: 14 }}>
                <TextField
                  id="clinicName"
                  label="医院名"
                  required
                  type="text"
                  placeholder="例)〇〇歯科クリニック"
                  value={values.clinicName}
                  onChange={handleChange("clinicName")}
                  onBlur={handleBlur("clinicName")}
                  error={fieldError("clinicName")}
                  readOnly={authenticatedProfile !== null}
                />
                <TextField
                  id="clinicUrl"
                  label="公式サイトURL"
                  required
                  type="url"
                  placeholder="https://example-clinic.jp"
                  value={values.clinicUrl}
                  onChange={handleChange("clinicUrl")}
                  onBlur={handleBlur("clinicUrl")}
                  error={fieldError("clinicUrl")}
                  readOnly={authenticatedProfile !== null}
                />
                <TextField
                  id="contactEmail"
                  label="メールアドレス"
                  required
                  type="email"
                  placeholder="例)info@example-clinic.jp"
                  value={values.contactEmail}
                  onChange={handleChange("contactEmail")}
                  onBlur={handleBlur("contactEmail")}
                  error={fieldError("contactEmail")}
                  readOnly={authenticatedProfile !== null}
                />
                <TextField
                  id="contactPhone"
                  label="電話番号"
                  required
                  type="tel"
                  placeholder="例)03-1234-5678"
                  value={values.contactPhone}
                  onChange={handleChange("contactPhone")}
                  onBlur={handleBlur("contactPhone")}
                  error={fieldError("contactPhone")}
                  readOnly={Boolean(authenticatedProfile?.contactPhone)}
                />
              </div>

              {/* 6. 任意入力(必須項目より視覚的に弱くする。2026-09-06のユーザー指示:
                  「まず3項目入力すれば診断できる」ことが一目で分かるよう、必須ブロックより
                  さらに背景を薄く・paddingを小さく・label強度を下げる。任意バッジは維持) */}
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: "#FAFBFC",
                  border: `1px solid #EEF1F5`,
                  borderRadius: 12,
                }}
              >
                <p style={{ margin: 0, fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>
                  精度を高めるための任意情報
                </p>
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  <TextField
                    id="gbpUrl"
                    label="GoogleビジネスプロフィールURL"
                    required={false}
                    type="url"
                    placeholder="https://g.page/example-clinic"
                    value={values.gbpUrl}
                    onChange={handleChange("gbpUrl")}
                    onBlur={handleBlur("gbpUrl")}
                    error={fieldError("gbpUrl")}
                    weak
                  />
                  <TextField
                    id="bookingUrl"
                    label="Web予約URL"
                    required={false}
                    type="url"
                    placeholder="https://example-clinic.jp/reserve"
                    value={values.bookingUrl}
                    onChange={handleChange("bookingUrl")}
                    onBlur={handleBlur("bookingUrl")}
                    error={fieldError("bookingUrl")}
                    weak
                  />
                </div>
              </div>

              {duplicateCandidate ? (
                <div className="ds-duplicate-notice" role="alert">
                  <strong>同じ医院の可能性があります</strong>
                  <p>{duplicateCandidate.message}</p>
                  <div className="ds-duplicate-actions">
                    <a href="/login" className="ds-duplicate-login">
                      ログインする
                    </a>
                    <button
                      type="button"
                      className="ds-duplicate-continue"
                      onClick={handleContinueDuplicate}
                    >
                      別データとして診断を続ける
                    </button>
                  </div>
                </div>
              ) : (
                <button type="submit" className="ds-cta" disabled={checkingDuplicate}>
                  {checkingDuplicate ? "医院情報を確認中…" : "無料でAI集患診断をする"}
                </button>
              )}

              {/* 8. CTA下 */}
              <p style={{ margin: "10px 0 0", fontSize: 12, color: MUTED, textAlign: "center" }}>
                約60秒・無料・電話番号必須
              </p>
            </form>
          </section>
        </div>
      </div>

      <style jsx>{`
        .ds-shell {
          max-width: 1360px;
          margin: 0 auto;
          padding: 28px 20px 0;
          display: grid;
          grid-template-columns: 1fr;
          gap: 28px;
        }
        .ds-left {
          display: flex;
          flex-direction: column;
          gap: 28px;
          min-width: 0;
        }
        .ds-signed-in-notice {
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid #bfdbfe;
          border-radius: 10px;
          background: #eff6ff;
          color: #1e3a5f;
          font-size: 12px;
          line-height: 1.7;
        }
        .ds-duplicate-notice {
          margin-top: 18px;
          padding: 14px;
          border: 1px solid #fbbf24;
          border-radius: 12px;
          background: #fffbeb;
          color: #78350f;
          font-size: 13px;
          line-height: 1.7;
        }
        .ds-duplicate-notice p {
          margin: 6px 0 0;
        }
        .ds-duplicate-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .ds-duplicate-login,
        .ds-duplicate-continue {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 40px;
          box-sizing: border-box;
          padding: 8px 14px;
          border-radius: 9px;
          font-size: 12px;
          font-weight: 700;
          text-decoration: none;
        }
        .ds-duplicate-login {
          border: 0;
          background: ${BLUE};
          color: #fff;
        }
        .ds-duplicate-continue {
          border: 1px solid #d97706;
          background: #fff;
          color: #92400e;
          cursor: pointer;
        }
        .ds-left-logo img {
          height: 36px;
        }
        .ds-heading {
          margin: 0;
          font-size: 24px;
          color: ${NAVY};
          font-weight: 700;
          line-height: 1.3;
        }
        .ds-main-copy {
          margin: 12px 0 0;
          font-size: 15px;
          color: #374151;
          line-height: 1.8;
        }
        .ds-eyebrow {
          margin: 0 0 8px;
          font-size: 12px;
          font-weight: 700;
          color: ${BLUE};
          letter-spacing: 0.02em;
        }
        .ds-insight-grid {
          margin-top: 16px;
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }
        .ds-right {
          min-width: 0;
        }
        .ds-form-card {
          background: #fff;
          border: 1px solid ${BORDER};
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 1px 2px rgba(15, 27, 45, 0.04);
        }
        .ds-cta {
          display: block;
          width: 100%;
          margin-top: 18px;
          background: ${BLUE};
          color: #fff;
          padding: 15px 24px;
          border-radius: 999px;
          border: none;
          font-weight: 700;
          font-size: 16px;
          cursor: pointer;
        }
        .ds-cta:disabled {
          cursor: wait;
          opacity: 0.7;
        }

        /* PC(768px以上): 中央の細い1カラムカードをやめ、画面全体を使った
           左(価値訴求)約44% / 右(フォーム)約56%のワイド2カラムにする
           (2026-09-07のユーザー指示「左40-45% / 右55-60%」)。 */
        @media (min-width: 768px) {
          .ds-shell {
            grid-template-columns: 44% 56%;
            /* 2026-09-07のユーザー指示: 左右の縦位置ズレ修正。align-items: startを基本にし、
               左カラムだけjustify-content:centerや大きなmargin-topを入れない
               (=左カラムのロゴ上端と右フォームカード上端を揃える)。 */
            align-items: start;
            gap: 64px;
            padding: 56px 40px 0;
            min-height: calc(100vh - 56px);
          }
          .ds-left {
            gap: 40px;
          }
          .ds-left-logo img {
            height: 42px;
          }
          .ds-heading {
            font-size: 34px;
          }
          .ds-main-copy {
            font-size: 17px;
            margin-top: 16px;
          }
          .ds-insight-grid {
            margin-top: 20px;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
          }
          .ds-form-card {
            padding: 32px;
            border-radius: 20px;
          }
        }

        @media (min-width: 1024px) {
          .ds-shell {
            gap: 80px;
          }
        }
      `}</style>
    </main>
  );
}

function Reassurance({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "#EFF6FF",
        border: "1px solid #DBEAFE",
        borderRadius: 999,
        padding: "7px 10px",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <circle cx="10" cy="10" r="10" fill="#2563EB" />
        <path d="M6 10.5l2.5 2.5L14 7.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ fontSize: 12, color: "#1E3A8A", fontWeight: 600 }}>{text}</span>
    </div>
  );
}

type InsightIconKind = "eye" | "compare" | "trend";

/**
 * 2026-09-07のユーザー指示: SpecialistCardと同一原因(styled-jsxはコンポーネント単位で
 * スコープされるため、DiagnosisPage側の<style jsx>はInsightCardという別関数の中の要素には
 * 適用されない)でカードスタイルが実画面に反映されていなかったため、InsightCardも
 * className/外部CSSに頼らずinline styleへ全面書き換え。
 * アイコンは新規イラスト素材を作らず、シンプルな線画のUIアイコン(SVG)のみを使用する。
 */
function InsightIcon({ kind }: { kind: InsightIconKind }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: BLUE,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (kind === "eye") {
    return (
      <svg {...common}>
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (kind === "compare") {
    return (
      <svg {...common}>
        <path d="M4 21V10" />
        <path d="M12 21V4" />
        <path d="M20 21v-7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 6h6v6" />
    </svg>
  );
}

function InsightCard({
  icon,
  title,
  description,
}: {
  icon: InsightIconKind;
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 4,
        padding: "14px 12px",
        borderRadius: 13,
        background: "linear-gradient(180deg, #FFFFFF 0%, #F6F9FF 100%)",
        border: `1px solid ${INSIGHT_CARD_BORDER}`,
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: "#EAF1FE",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <InsightIcon kind={icon} />
      </div>
      <span
        style={{
          marginTop: 2,
          fontSize: 12,
          fontWeight: 700,
          color: NAVY,
          lineHeight: 1.4,
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: 10.5,
          color: MUTED,
          lineHeight: 1.5,
        }}
      >
        {description}
      </span>
    </div>
  );
}

/**
 * 2026-09-07のユーザー指示: 「診断後のサポートがある安心感」を伝える小さめの安心カード。
 * 表示人物はbrand/ai-specialists/の既存AI生成素材(1名・public/brand/ai-specialists/
 * specialist-01.pngとして複製配置。新規人物生成は行っていない)。
 * 重要な表現ルール:
 * - 「AI生成モデル」バッジを人物画像のすぐ近くに必ず表示する。
 * - 「この人があなたを担当します」「スペシャリスト本人が対応します」等、実在の専属担当者
 *   であるかのような表現は使わない(氏名も表示しない)。
 * - 架空の資格・実績・相談件数は一切表示しない。
 * - コピーはユーザー指定の推奨文言をそのまま使用する。
 */
/**
 * 2026-09-07のユーザー指示(2回目の手描きレイアウト)で、eyebrow/見出し/本文/下部の
 * 「スペシャリストに相談する」行を含む最終構成に更新。
 * 「スペシャリストに相談する」行はこの入力画面時点では実体のある機能・遷移先が無い
 * (診断後に使える旨の注記どおり、将来result page側等で提供される想定)ため、
 * <a>/<button>にはせず非活性な案内テキストとして表示する
 * (存在しないリンク・ダミーの遷移を作らないため)。
 */
function SpecialistCard() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 18px",
        borderRadius: 16,
        border: `1px solid ${GOLD_BORDER}`,
        background: GOLD_BG,
        boxShadow: "0 1px 3px rgba(120, 95, 30, 0.10)",
      }}
    >
      {/* 2026-09-07のユーザー指示: 元画像サイズに関係なく60x60pxを超えないよう、
          className/外部CSSに頼らずimg要素へ直接サイズを固定する。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/ai-specialists/specialist-01.png"
        alt="DENT SHIFTサポートのイメージ(AI生成モデル)"
        style={{
          width: "60px",
          height: "60px",
          minWidth: "60px",
          maxWidth: "60px",
          flex: "0 0 60px",
          objectFit: "cover",
          borderRadius: "50%",
          display: "block",
          border: `1px solid ${GOLD_BORDER}`,
          background: "#fff",
        }}
      />
      <div style={{ minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 9.5,
            fontWeight: 700,
            color: GOLD_TEXT,
            letterSpacing: "0.06em",
          }}
        >
          SPECIALIST SUPPORT
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12.5, fontWeight: 700, color: NAVY, lineHeight: 1.5 }}>
          診断後は、専門チームに相談できます
        </p>
        {/* 「AI生成モデル」は必ずbadge化する(普通の1行テキストにしない、2026-09-07のユーザー指示)。 */}
        <span
          style={{
            display: "inline-block",
            marginTop: 4,
            fontSize: 9,
            fontWeight: 700,
            color: GOLD_TEXT,
            background: GOLD_BADGE_BG,
            border: `1px solid ${GOLD_BORDER}`,
            borderRadius: 999,
            padding: "2px 6px",
            whiteSpace: "nowrap",
          }}
        >
          AI生成モデル
        </span>
        <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "#4b5563", lineHeight: 1.6 }}>
          AI診断の改善内容について、DENT SHIFTのCS・専門チームが対応します。
        </p>
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: `1px solid ${GOLD_BORDER}`,
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              fontWeight: 700,
              color: GOLD_TEXT,
            }}
          >
            <SparkleIcon />
            スペシャリストに相談する
          </span>
          <span style={{ fontSize: 10, color: MUTED }}>※診断後、必要に応じて利用できます</span>
        </div>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M10 2l1.6 4.8L16.4 8.4 11.6 10 10 14.8 8.4 10 3.6 8.4 8.4 6.8z" fill={GOLD_TEXT} />
    </svg>
  );
}

function TextField({
  id,
  label,
  required,
  type,
  placeholder,
  value,
  onChange,
  onBlur,
  error,
  weak,
  readOnly,
}: {
  id: string;
  label: string;
  required: boolean;
  type: "text" | "url" | "email" | "tel";
  placeholder: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur: (e: FocusEvent<HTMLInputElement>) => void;
  error: string | null;
  weak?: boolean;
  readOnly?: boolean;
}): ReactNode {
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: weak ? 11 : 13,
          fontWeight: weak ? 400 : 600,
          color: weak ? "#9CA3AF" : NAVY,
        }}
      >
        {label}
        {required ? (
          <span style={{ color: ERROR, marginLeft: 4 }}>*</span>
        ) : (
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              fontWeight: 600,
              color: MUTED,
              background: "#F1F5F9",
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            任意
          </span>
        )}
      </span>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`ds-input${error ? " ds-input-error" : ""}${weak ? " ds-input-weak" : ""}${readOnly ? " ds-input-readonly" : ""}`}
      />
      {error && (
        <span id={`${id}-error`} style={{ fontSize: 12, color: ERROR }}>
          {error}
        </span>
      )}
      <style jsx>{`
        .ds-input {
          width: 100%;
          box-sizing: border-box;
          height: 48px;
          padding: 0 14px;
          border: 1px solid ${BORDER};
          border-radius: 10px;
          font-size: 15px;
          color: ${NAVY};
          background: #fff;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .ds-input-weak {
          background: #fff;
        }
        .ds-input-readonly {
          color: #475569;
          background: #f8fafc;
          cursor: default;
        }
        .ds-input::placeholder {
          color: #9ca3af;
        }
        .ds-input:focus {
          outline: none;
          border-color: ${BLUE};
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
        }
        .ds-input-error {
          border-color: ${ERROR};
        }
        .ds-input-error:focus {
          border-color: ${ERROR};
          box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12);
        }
        @media (max-width: 420px) {
          .ds-input {
            font-size: 16px;
          }
        }
      `}</style>
    </label>
  );
}
