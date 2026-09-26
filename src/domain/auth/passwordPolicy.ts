// 一般ユーザーのパスワード再設定でも運営者と同じ強度要件(8文字以上・英字1・数字1)を使う。
export {
  validateOperatorPassword as validatePassword,
  OPERATOR_PASSWORD_REQUIREMENTS_MESSAGE as PASSWORD_REQUIREMENTS_MESSAGE,
} from "./operatorPassword";
