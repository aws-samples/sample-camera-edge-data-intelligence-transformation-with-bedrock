// 必須環境変数チェック関数
export const requiredEnvVar = (name, value) => {
  if (!value) {
    throw new Error(`必須環境変数 ${name} が設定されていません。正しい値を設定してください。`);
  }
  return value;
}; 