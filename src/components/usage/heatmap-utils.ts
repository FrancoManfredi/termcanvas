export interface HeatmapValue {
  tokens: number;
  cost: number;
}

/**
 * Merge local and cloud heatmaps, taking the max of tokens and cost per day.
 * Cloud may have multi-device data; local may have pre-login data.
 */
export function mergeUsageHeatmaps(
  localHeatmap: Record<string, HeatmapValue>,
  cloudHeatmap: Record<string, HeatmapValue>,
): Record<string, HeatmapValue> {
  const merged: Record<string, HeatmapValue> = {};

  for (const [date, entry] of Object.entries(localHeatmap)) {
    merged[date] = { ...entry };
  }

  for (const [date, cloudEntry] of Object.entries(cloudHeatmap)) {
    const localEntry = merged[date];
    if (!localEntry) {
      merged[date] = { ...cloudEntry };
      continue;
    }
    merged[date] = {
      tokens: Math.max(localEntry.tokens, cloudEntry.tokens),
      cost: Math.max(localEntry.cost, cloudEntry.cost),
    };
  }

  return merged;
}
