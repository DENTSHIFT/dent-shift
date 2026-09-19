/**
 * OpenAI Responses APIへ渡すrequestの内部表現(2026-09-08のユーザー指示: request
 * descriptor)。
 *
 * Phase 1では公式SDKの型へは一切依存せず、DENT SHIFT内部のrequest descriptorとして
 * 定義する。将来のSDK layer(Phase 3)が、このdescriptorを実際のResponses API
 * request(`tools`/`tool_choice`/`input`配列等)へ写像する。
 *
 * 【instruction/data境界】developerInstructionとuserQuestionは意図的に別フィールドに
 * 分離しており、このモジュール内のどこでも1つの文字列へ連結しない(2026-09-08の
 * ユーザー指示: prompt injection耐性のテスト17が検証する構造的な保証)。Phase 3で
 * 実際のResponses APIへ写像する際も、developerInstructionは`role: "developer"`
 * (またはsystem)、userQuestionは`role: "user"`という別々のメッセージにする想定。
 */
export interface OpenAiRequestDescriptorUserLocation {
  /** ISO 3166-1 alpha-2の国コード。P0では医院の住所情報を保持していないため
   *  "JP"固定のみを扱う(city/regionは推測材料が無いため今回は導入しない)。 */
  country: "JP";
}

export interface OpenAiRequestDescriptor {
  /** env(OPENAI_AI_MEASUREMENT_MODEL、Phase 3で導入)から解決されたrequested model。 */
  model: string;
  /** P0で使うtool種別。既存canonical measurementMeta.toolTypeの語彙と揃える。 */
  toolType: "web_search";
  /** web search toolを必ず使わせる(OpenAI公式Responses APIの`tool_choice: "required"`
   *  に対応)。ただしsearchExecutedの最終判定は実responseの`web_search_call`実発生の
   *  みで行う(既存openAiAdapter.tsの既存ロジック、Phase 1では変更しない)。 */
  toolChoice: "required";
  userLocation: OpenAiRequestDescriptorUserLocation;
  /** 固定のタスク指示文(質問・医院情報を含まない)。 */
  developerInstruction: string;
  /** 患者質問そのもの(データとして扱う。指示として解釈しない)。 */
  userQuestion: string;
  /** prompt文面のバージョンタグ(measurementMeta.promptVersionへ最終的に反映される想定)。 */
  promptVersion: string;
}
