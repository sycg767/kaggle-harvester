export interface HoverSeries {
  id: number;
  points: { x: number; y: number }[];
}

export interface TrajectoryHit {
  seriesId: number;
  pointIndex: number;
}

// Measure distance to the whole line, so sparse trajectories are as easy to inspect as dense ones.
export function findTrajectoryHit(
  series: HoverSeries[], x: number, y: number, radius = 16,
): TrajectoryHit | null {
  let nearest: TrajectoryHit | null = null;
  let bestDistance = radius * radius;
  for (const item of series) {
    for (let index = 0; index < item.points.length; index += 1) {
      const start = item.points[index];
      const end = item.points[index + 1] ?? start;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / length));
      const distance = (x - start.x - t * dx) ** 2 + (y - start.y - t * dy) ** 2;
      if (distance <= bestDistance && (nearest === null || distance < bestDistance)) {
        bestDistance = distance;
        nearest = { seriesId: item.id, pointIndex: t > 0.5 ? index + 1 : index };
      }
    }
  }
  return nearest;
}
