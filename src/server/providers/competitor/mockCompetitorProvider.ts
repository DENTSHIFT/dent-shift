import { seededRandom } from "@/lib/prng";
import type { CompetitorClinic } from "@/domain/competitor/types";
import type { CompetitorProvider } from "./types";

const NAME_SUFFIXES = ["デンタルクリニック", "歯科医院", "歯科クリニック"];

/**
 * P0用のモック競合プロバイダー。実際のGBP/検索結果には接続せず、
 * 医院名をシードにした3院のダミー競合を返す(引き継ぎ書 Step3: 競合3院)。
 */
export class MockCompetitorProvider implements CompetitorProvider {
  readonly name = "mock-competitor-provider";

  async findNearbyCompetitors(clinicName: string): Promise<CompetitorClinic[]> {
    const rand = seededRandom(`competitors:${clinicName}`);
    return [0, 1, 2].map((i) => ({
      id: `mock-competitor-${i}`,
      name: `[サンプル]近隣${NAME_SUFFIXES[i % NAME_SUFFIXES.length]}${i + 1}`,
      distanceKm: Math.round((0.5 + rand() * 3) * 10) / 10,
    }));
  }
}
