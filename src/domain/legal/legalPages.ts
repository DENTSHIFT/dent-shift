/**
 * 法務ページ(運営会社/お問い合わせ/利用規約/プライバシーポリシー/特定商取引法に基づく表記/
 * Cookieポリシー)の構造定義(2026-09-23作成)。
 *
 * 重要: このファイルは「ページ構造」と「不足している事実情報の一覧」のみを保持する。
 * 法的な条文・会社情報(正式名称/住所/代表者名/返金条件/保存期間等)は一切推測・創作しない。
 * `approvedBody`が設定されるまで、各ページは「内容未確定」であることを明示して表示する
 * (2026-09-22公開前QAで発見された公開ブロッカーへの対応、指示書の明示的要件)。
 *
 * 承認済み原稿が用意でき次第、該当slugの`approvedBody`にMarkdown相当の文字列(または
 * ReactNode配列)を設定すれば、LegalPageLayout側のロジックを変更せずに公開できる設計にする。
 */

export type LegalPageSlug = "company" | "contact" | "terms" | "privacy" | "tokushoho" | "cookies";

export interface LegalPageSection {
  /** このページに掲載するために必要な事実情報のうち、現時点で未確認の項目。 */
  missingFacts: string[];
  /** コードから機械的に確認できた事実(表示してよい)。空配列の場合は「確認できた事実なし」。 */
  verifiedFromCode: string[];
}

export interface LegalPageDefinition {
  slug: LegalPageSlug;
  title: string;
  /** フッター等でのリンク文言。 */
  navLabel: string;
  section: LegalPageSection;
  /**
   * 承認済み本文。null の間は「内容未確定」ページとして表示し、
   * 検索エンジンにインデックスさせない(noindex)。
   */
  approvedBody: string | null;
  /** 承認済み本文が公開された日付(YYYY-MM-DD)。approvedBodyがnullの間はnull。 */
  updatedAt: string | null;
}

export const LEGAL_PAGES: Record<LegalPageSlug, LegalPageDefinition> = {
  company: {
    slug: "company",
    title: "運営会社",
    navLabel: "運営会社",
    approvedBody: null,
    updatedAt: null,
    section: {
      verifiedFromCode: [],
      missingFacts: [
        "正式な会社名(法人格を含む商号)",
        "本店所在地(住所)",
        "代表者名",
        "設立年月日",
        "資本金(記載する場合)",
        "事業内容の正式な説明文",
        "会社の連絡先(電話番号・メールアドレス、問い合わせページと重複可)",
      ],
    },
  },
  contact: {
    slug: "contact",
    title: "お問い合わせ",
    navLabel: "お問い合わせ",
    approvedBody: null,
    updatedAt: null,
    section: {
      // NEXT_PUBLIC_SUPPORT_PHONE_NUMBER はコード上で確認済み(利用者向け電話問い合わせ導線)。
      // ただし正式な公開可否・受付時間等は要確認のため、ここでは事実の存在のみ記録する。
      verifiedFromCode: [
        "電話でのお問い合わせ導線が既存画面(LP/ダッシュボード/診断結果)に存在する(環境変数 NEXT_PUBLIC_SUPPORT_PHONE_NUMBER)",
      ],
      missingFacts: [
        "お問い合わせ受付時間(電話・メール共通)",
        "問い合わせ用メールアドレス(専用アドレスの有無)",
        "問い合わせフォームを別途設置するかどうかの方針",
        "返信までの目安期間",
      ],
    },
  },
  terms: {
    slug: "terms",
    title: "利用規約",
    navLabel: "利用規約",
    approvedBody: null,
    updatedAt: null,
    section: {
      verifiedFromCode: [],
      missingFacts: [
        "契約の成立時点・当事者の定義",
        "禁止事項の正式な条文",
        "免責事項の正式な条文(診断結果・改善提案の位置づけを含む)",
        "知的財産権の帰属",
        "退会・解約に関する正式な条文(実装済みのStripe解約フローとの整合)",
        "規約変更時の通知方法",
        "準拠法・裁判管轄",
        "反社会的勢力の排除条項",
      ],
    },
  },
  privacy: {
    slug: "privacy",
    title: "プライバシーポリシー",
    navLabel: "プライバシーポリシー",
    approvedBody: null,
    updatedAt: null,
    section: {
      // データフロー調査(下記「コード上で確認できたデータフロー」)で判明した事実のうち、
      // ポリシー本文に直接使える確認済み事項のみをここに転記する。
      verifiedFromCode: [
        "収集する情報: 医院名・院長名・メールアドレス・電話番号・医院URL(診断フォーム/会員登録時)。院長名は医院情報の一部として保存し、Contact(利用者アカウント)側には氏名項目自体が存在しない",
        "電話番号はSMS本人確認(Twilio Verify)へ電話番号とワンタイムコードのみ送信。OTPコード自体はDB非保存",
        "診断結果(スコア・改善提案等)はデータベースに保存され、ダッシュボード上で医院本人が閲覧できる。患者個人情報は診断結果テーブルに保存しない設計(コード上の除外方針)",
        "メール配信にResendを利用(診断結果メール・会員登録のメール認証の2種類)",
        "決済にStripeを利用。カード番号自体はDENT SHIFT側では保持せずStripe Checkout上で入力される。メールアドレス・医院ID・プラン情報のみStripeへ送信",
        "Salesforce連携が有効化された場合、メールアドレス・医院名・医院URL・電話番号・登録ステップ等をCRMへ送信する設計(現状はdisabled設定でコード上有効化されていない)",
        "OpenAIには患者質問文と固定の指示文のみを送信し、医院名・医院URL・競合名は送信しない設計(コード上明示的に除外)",
        "LINE WORKS連携は未実装(呼び出すと常にエラーになるスタブ)",
      ],
      missingFacts: [
        "個人情報保護管理者・苦情相談窓口の名称と連絡先",
        "第三者提供の有無とその法的根拠(委託先一覧の正式な開示文言。Resend/Stripe/Twilio/Salesforce/OpenAIの委託先としての扱い)",
        "保存期間・削除方針(重要: コード上に診断結果・医院情報・アカウント情報を自動削除/退会時に削除する仕組みは一切実装されていない。無期限保存が事実上の現状であり、法的な保存期間ポリシーの策定と、必要であれば削除機構の実装が別途必要)",
        "開示・訂正・利用停止等の請求手続きの窓口",
        "外国にある第三者への提供の有無(Resend/Stripe/Twilio/Salesforce/OpenAIの実際のサーバー所在地・データ移転の法的整理)",
        "データベースの物理的なホスティング地域(候補: Neon/Supabase等の管理型Postgres、コード上は最終決定されていない)",
        "Cookie等の外部送信規律(電気通信事業法)に基づく公表事項の正式な整理(現状、自社セッションCookie以外に第三者解析タグは未導入)",
        "TimeRex Webhook経由で実際にどのデータを受信しているかの正式な整理(Webhookのハンドラ実装自体は未確認)",
      ],
    },
  },
  tokushoho: {
    slug: "tokushoho",
    title: "特定商取引法に基づく表記",
    navLabel: "特定商取引法に基づく表記",
    approvedBody: null,
    updatedAt: null,
    section: {
      verifiedFromCode: [
        "料金は月額サブスクリプション制(ライト¥14,800/スタンダード¥39,800/プレミアム¥79,800、税込)",
        "支払い方法はStripe経由のクレジットカード決済",
        "7日間無料トライアルが実装されている(ライト・スタンダードのみ、プレミアムは対象外)",
      ],
      missingFacts: [
        "販売事業者名(正式名称)",
        "運営統括責任者名",
        "所在地・電話番号(公開可否含む)",
        "追加手数料等の有無(振込手数料等)",
        "返品・キャンセルに関する正式な条件(トライアル中解約以外のケース)",
        "引渡し時期(サービス提供開始時期)の正式な記載",
        "動作環境(推奨ブラウザ等)の正式な記載",
      ],
    },
  },
  cookies: {
    slug: "cookies",
    title: "Cookieポリシー",
    navLabel: "Cookieポリシー",
    approvedBody: null,
    updatedAt: null,
    section: {
      verifiedFromCode: [
        "セッション維持用Cookie(ds_session)を認証に使用(httpOnly)",
        "現時点でコード上に第三者アクセス解析タグ(Google Analytics等)は確認されていない",
      ],
      missingFacts: [
        "将来的にアクセス解析・広告タグを導入する予定の有無",
        "Cookieの保持期間の正式な方針",
        "Cookie無効化時の影響についての正式な説明文",
      ],
    },
  },
};

export const LEGAL_PAGE_SLUGS = Object.keys(LEGAL_PAGES) as LegalPageSlug[];

/**
 * 2026-09-23のユーザー指示: noindexはアクセス制御ではないため、単独の非公開手段として
 * 扱わない。承認済み本文(approvedBody)が設定されているかどうかだけを、
 * 「公開してよいか」の唯一の判定基準にする(フッター表示・本番環境での404制御の両方で
 * この関数を共有し、判定基準がずれないようにする)。
 */
export function isLegalPagePubliclyVisible(page: LegalPageDefinition): boolean {
  return page.approvedBody !== null;
}
