// 外部乱数ライブラリに依存しない、決定論的な擬似乱数生成器。
// mock providerの結果を「毎回ランダムでテストできない」状態にしないための最小実装。
// 本番AIプロバイダーに差し替える際はこのファイルごと不要になる(server/providers配下のみ差し替え)。

export function hashStringToSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRandom(seedInput: string): () => number {
  return mulberry32(hashStringToSeed(seedInput));
}
