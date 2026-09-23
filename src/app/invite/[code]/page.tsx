import Link from "next/link";
import { getInviteByCode } from "@/server/db/inviteRepository";
import { validateInvite } from "@/domain/invite/inviteCode";
import { getCurrentContact } from "@/server/auth/session";
import { resolvePilotInviteConfigFromProcessEnv } from "@/server/config/pilotInviteConfig";
import styles from "../../auth.module.css";
import { InviteCheckoutButton } from "./InviteCheckoutButton";
import { PilotActivateButton } from "./PilotActivateButton";

/**
 * 知人院長向け招待ページ(2026-09-22確定)。通常の「1円モニター利用」(Stripe決済あり)
 * と、「パイロット先行利用」(isPilot===true、test環境限定、Stripeを一切呼ばない)の
 * 2種類を、isPilotフラグとPILOT_INVITE_MODEで分岐する。
 * 通常LP・料金表には一切リンクを置かず、この招待URLを直接知っている場合のみ到達する。
 * 無効・期限切れ・使用済みの場合も存在有無を詳細に区別せず、一律の案内文にする。
 */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await getInviteByCode(code);
  const contact = await getCurrentContact();

  const isPilotInvite = invite?.isPilot === true;
  const pilotConfig = resolvePilotInviteConfigFromProcessEnv();
  // パイロットmodeが無効な環境(productionを含む)では、pilot招待自体を「利用不可」扱いにする。
  const isPilotUsable = isPilotInvite && pilotConfig.mode === "enabled";

  const isValid =
    invite &&
    (!isPilotInvite || isPilotUsable) &&
    validateInvite({
      status: invite.status,
      startsAt: invite.startsAt,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
      usedCount: invite.usedCount,
    }).valid;

  return (
    <main className={styles.shell}>
      <div className={`${styles.card} ${styles.cardWide}`}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.logo}
            src="/brand/logo/DENT_SHIFT_horizontal_tagline_transparent.png"
            alt="DENT SHIFT 歯科集患を、AIでシフトする。"
            width={1844}
            height={572}
          />
        </div>

        {!isValid ? (
          <>
            <h1 className={styles.title}>この招待URLは現在ご利用いただけません</h1>
            <p className={styles.description}>
              期限切れ、使用済み、またはURLが正しくない可能性があります。招待元にご確認ください。
            </p>
          </>
        ) : (
          <>
            {isPilotInvite ? (
              <>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#2563EB" }}>
                  木村正人からの特別オファー
                </p>
                <h1 className={styles.title} style={{ marginTop: 6 }}>
                  {invite.clinicName}先生だけが利用できる限定プランです。
                </h1>
                <p className={styles.description}>
                  このオファーは、DENT SHIFT開発者 木村正人 から直接ご案内した医院様限定の特別プランです。
                </p>

                <div
                  style={{
                    marginTop: 20,
                    padding: 16,
                    border: "1px solid #E5E9F0",
                    borderRadius: 12,
                    background: "#F8FAFC",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <Row
                    label="機能"
                    value={
                      invite.pilotDurationDays != null
                        ? `スタンダードプラン相当機能を${invite.pilotDurationDays}日間無料でご利用いただけます`
                        : `スタンダードプラン相当機能を${invite.durationMonths}か月無料でご利用いただけます`
                    }
                  />
                  <Row
                    label="利用期間"
                    value={
                      invite.pilotDurationDays != null
                        ? `${invite.pilotDurationDays}日間`
                        : `${invite.durationMonths}か月間`
                    }
                  />
                  <Row label="クレジットカード" value="登録不要です" />
                  <Row label="お支払い" value="発生しません" />
                </div>

                <p className={styles.helper} style={{ marginTop: 16 }}>
                  一般公開されている通常プランとは異なり、DENT
                  SHIFTの開発・改善にご協力いただく医院様向けにご用意しています。
                  <br />
                  この招待URLをお持ちの医院様のみ利用できます。
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#2563EB" }}>
                  DENT SHIFT 特別招待
                </p>
                <h1 className={styles.title} style={{ marginTop: 6 }}>
                  {invite.clinicName} 様
                </h1>
                <p className={styles.description}>
                  DENT SHIFTを特別価格でモニターご利用いただけます。
                </p>

                <div
                  style={{
                    marginTop: 20,
                    padding: 16,
                    border: "1px solid #E5E9F0",
                    borderRadius: 12,
                    background: "#F8FAFC",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <Row label="機能" value="スタンダードプラン相当" />
                  <Row label="月額" value={`${invite.specialPriceJpy}円（税込）`} />
                  <Row label="利用期間" value={`${invite.durationMonths}か月間`} />
                  <Row label="期間終了後" value="自動的にご請求は終了します(通常料金への自動移行はありません)" />
                </div>

                <p className={styles.helper} style={{ marginTop: 16 }}>
                  継続してご利用いただく場合は、期間終了後にご自身で通常プランをお申し込みください。
                  自動的に通常料金(月額14,800円〜)へ切り替わることはありません。
                </p>
              </>
            )}

            <div style={{ marginTop: 20 }}>
              {contact ? (
                isPilotInvite ? (
                  <PilotActivateButton
                    inviteCode={code}
                    requireEmailMatch={invite.requireEmailMatch}
                    inviteEmail={invite.email}
                    currentEmail={contact.email}
                  />
                ) : (
                  <InviteCheckoutButton
                    inviteCode={code}
                    requireEmailMatch={invite.requireEmailMatch}
                    inviteEmail={invite.email}
                    currentEmail={contact.email}
                  />
                )
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <p className={styles.helper} style={{ margin: 0 }}>
                    ご利用にはDENT SHIFTへのログインが必要です。
                  </p>
                  <Link
                    className={styles.primaryButton}
                    style={{ textAlign: "center", textDecoration: "none" }}
                    href={`/signup?next=${encodeURIComponent(`/invite/${code}`)}&email=${encodeURIComponent(invite.email)}${isPilotInvite ? `&clinicName=${encodeURIComponent(invite.clinicName)}` : ""}`}
                  >
                    無料会員登録してはじめる
                  </Link>
                  <p className={styles.switchLink}>
                    すでにアカウントをお持ちの方は <Link href="/login">ログイン</Link>
                    してからこのページに戻ってください
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
      <span style={{ color: "#6B7280" }}>{label}</span>
      <span style={{ color: "#0F1B2D", fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}
