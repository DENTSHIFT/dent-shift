import "server-only";
import { prisma } from "@/server/db/prismaClient";
import { hashEmailVerificationToken } from "@/server/auth/emailVerificationToken";
import { canTransitionRegistrationStep, type RegistrationStep } from "@/domain/auth/registrationStep";
import { enqueueIntegrationEvent } from "@/server/db/integrationEventRepository";

export type VerifyEmailTokenResult =
  | { status: "verified"; contactId: string; email: string }
  | { status: "already_verified"; contactId: string; email: string }
  // 2026-10-03(PO指摘): トークン自体は無効/使用済みで見つからないが、
  // 現在ログイン中のセッション本人が別途確認済みだった場合のフォールバック。
  // 「このリンクが成功した」わけではない(トークンの持ち主の確認が成功したとは言えない)ため、
  // UI側で"already_verified"(トークン自身の持ち主が確認済み)と文言を区別できるよう
  // 別ステータスにする。認可ロジック(どのcontactを見るか)自体は変更していない。
  | { status: "already_verified_via_session"; contactId: string; email: string }
  | { status: "error"; code: "invalid" | "expired"; message: string };

/**
 * メール確認トークンの検証・消費処理(APIルートとUI画面の両方から共通で呼ぶ)。
 * トークンは平文で受け取るが、照合はDBに保存済みのハッシュと突き合わせて行う。
 * 2026-09-24: /api/auth/verify-email/route.tsから処理本体をここへ切り出し、
 * /verify-emailページ(UI)からも同じ処理を直接呼べるようにした
 * (API層とUI表示を分離。既存のAPI挙動・レスポンス形は変えない)。
 *
 * 2026-10-03(PO承認): 確認成功時にトークンハッシュをnull化して消費するため、
 * 「使用済みリンクをもう一度開く」操作は(契機のレース以外)原則としてここで
 * contactが見つからず"invalid"になる。これは正しいトークンでも再訪時は
 * 無効扱いになってしまい、「無効です・再送してください」という誤解を招く案内に
 * なっていた。対策として、呼び出し元から現在ログイン中のセッションのcontactId
 * (sessionContactId)を渡せるようにし、
 *   - トークン自体はDB上で見つからない(=使用済み/不正)が、
 *   - かつ現在ログイン中の本人(sessionContactIdで特定されるcontact)が
 *     既にemailVerifiedAt済みである
 * ことをサーバー側で確認できた場合に限り、"already_verified"として穏当な案内を
 * 返す。トークンの有効性チェック自体は一切緩めない(無効トークン単体では
 * 絶対に成功扱いにしない。セッションが無い、またはセッション本人が未確認の場合は
 * 従来通りinvalidのまま)。
 */
export async function verifyEmailToken(
  token: string,
  options?: { sessionContactId?: string | null }
): Promise<VerifyEmailTokenResult> {
  const tokenHash = hashEmailVerificationToken(token);
  const contact = await prisma.contact.findFirst({
    where: { emailVerificationTokenHash: tokenHash },
  });

  if (!contact) {
    const sessionContactId = options?.sessionContactId;
    if (sessionContactId) {
      const sessionContact = await prisma.contact.findUnique({
        where: { id: sessionContactId },
      });
      // ログイン中の本人が既に確認済みの場合に限り、穏当な案内にする。
      // (トークンが他人のものだったり不正な場合は、本人が未確認のままなので
      // ここには該当せず、下のinvalidエラーにフォールバックする)
      if (sessionContact?.emailVerifiedAt) {
        return {
          status: "already_verified_via_session",
          contactId: sessionContact.id,
          email: sessionContact.email,
        };
      }
    }
    return { status: "error", code: "invalid", message: "確認リンクが無効です" };
  }
  if (contact.emailVerifiedAt) {
    return { status: "already_verified", contactId: contact.id, email: contact.email };
  }
  if (!contact.emailVerificationExpiresAt || contact.emailVerificationExpiresAt < new Date()) {
    return {
      status: "error",
      code: "expired",
      message: "確認リンクの有効期限が切れています。再送してください",
    };
  }

  // 2026-09-25: メール確認の次は規約同意(その後にプラン選択・決済方法登録)。
  const nextStep: RegistrationStep = "consent";
  const currentStep = contact.registrationStep as RegistrationStep;
  const updatedStep = canTransitionRegistrationStep(currentStep, nextStep) ? nextStep : currentStep;

  // 2026-10-03: 同一トークンへの同時多重アクセス(例: メールクライアントのリンク先読み
  // による二重リクエスト、同じリンクを2タブで開く等)でSalesforce連携イベントが
  // 二重発行されるのを防ぐため、findFirstで見つけた行を無条件updateするのではなく、
  // 「まだこのトークンハッシュを持っている行」だけを対象にした条件付きupdateMany
  // (emailVerificationTokenHash: tokenHashをwhereに含める)で原子的に消費する。
  // 競合した側はcount: 0になるので、二重にemailVerifiedAtを設定したりイベントを
  // 発行したりしない(既にverified済みとして扱う)。
  const { count } = await prisma.contact.updateMany({
    where: { id: contact.id, emailVerificationTokenHash: tokenHash },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
      registrationStep: updatedStep,
    },
  });

  if (count === 0) {
    // count 0は「並行リクエストが先に消費した」以外にも起こりうる(例: この間に
    // メール再送で新しいトークンハッシュへ差し替わった等)。後者ではemailVerifiedAtは
    // 設定されていないため、無条件にalready_verifiedとして成功扱いにはしない。
    // 現在のDB状態を読み直し、実際に確認済みになっている場合に限り成功扱いとする。
    const latest = await prisma.contact.findUnique({ where: { id: contact.id } });
    if (latest?.emailVerifiedAt) {
      return { status: "already_verified", contactId: latest.id, email: latest.email };
    }
    return { status: "error", code: "invalid", message: "確認リンクが無効です" };
  }

  await enqueueIntegrationEvent({
    eventType: "email_verified",
    clinicId: contact.clinicId,
    contactId: contact.id,
    payload: {
      registration_step: updatedStep,
      // 2026-09-29追加(PO承認、Salesforce連携P0): メールアドレスが無いとLeadを
      // 特定できないため追加する(このイベントはcontact自体がメール確認対象のため必ず値がある)。
      email: contact.email,
      consent_accepted_at: contact.consentAcceptedAt,
    },
  }).catch((error) => {
    console.error("[verifyEmailToken] Salesforce sync enqueue failed:", error);
  });

  return { status: "verified", contactId: contact.id, email: contact.email };
}
