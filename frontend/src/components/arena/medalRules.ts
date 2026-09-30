export interface MedalCutoffRanks {
  goldRank: number;
  silverRank: number;
  bronzeRank: number;
}

/**
 * Calculates official Kaggle medal cutoff ranks based on total participating teams.
 * 
 * Official Kaggle Competition Progression System rules:
 * - 0–99 teams:
 *     Gold: Top 10%
 *     Silver: Top 20%
 *     Bronze: Top 40%
 * - 100–249 teams:
 *     Gold: Top 10
 *     Silver: Top 20%
 *     Bronze: Top 40%
 * - 250–999 teams:
 *     Gold: Top 10
 *     Silver: Top 50
 *     Bronze: Top 100
 * - 1000+ teams:
 *     Gold: Top 10 + 0.2%
 *     Silver: Top 5%
 *     Bronze: Top 10% (or custom bronzePercentile)
 * 
 * Kaggle medal thresholds strictly use downward integer truncation (Math.floor)
 * because qualifying for "Top P%" requires rank / totalTeams <= P%.
 * For example, with 10,208 teams:
 * - Gold: 10 + floor(10,208 * 0.002) = 10 + 20 = 30 (rank 31 is 10 + 0.2057% > Top 10 + 0.2%)
 * - Silver: floor(10,208 * 0.05) = floor(510.4) = 510 (rank 511 is 5.0058% > Top 5%)
 * - Bronze: floor(10,208 * 0.10) = floor(1020.8) = 1020 (rank 1021 is 10.0019% > Top 10%)
 */
export function calculateMedalRanks(totalTeams: number, bronzePercentile: number = 0.10): MedalCutoffRanks {
  const n = Math.max(0, Math.floor(totalTeams || 0));
  if (n <= 0) {
    return { goldRank: 0, silverRank: 0, bronzeRank: 0 };
  }

  let goldRank = 0;
  let silverRank = 0;
  let bronzeRank = 0;

  if (n < 100) {
    goldRank = Math.max(1, Math.floor(n * 0.10));
    silverRank = Math.max(goldRank, Math.floor(n * 0.20));
    bronzeRank = Math.max(silverRank, Math.floor(n * (bronzePercentile !== 0.10 ? bronzePercentile : 0.40)));
  } else if (n < 250) {
    goldRank = Math.min(10, n);
    silverRank = Math.max(goldRank, Math.floor(n * 0.20));
    bronzeRank = Math.max(silverRank, Math.floor(n * (bronzePercentile !== 0.10 ? bronzePercentile : 0.40)));
  } else if (n < 1000) {
    goldRank = Math.min(10, n);
    silverRank = Math.min(50, n);
    bronzeRank = bronzePercentile !== 0.10
      ? Math.max(silverRank, Math.floor(n * bronzePercentile))
      : Math.min(100, n);
  } else {
    // 1000+ teams
    goldRank = Math.min(n, 10 + Math.floor(n * 0.002));
    silverRank = Math.max(goldRank, Math.floor(n * 0.05));
    bronzeRank = Math.max(silverRank, Math.floor(n * bronzePercentile));
  }

  return { goldRank, silverRank, bronzeRank };
}
