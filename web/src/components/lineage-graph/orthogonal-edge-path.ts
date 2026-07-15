import type { LineageLayoutPoint } from "./layout.js";

export function edgePointsToPath(points: readonly LineageLayoutPoint[]): string {
  if (points.length === 0) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`)
    .join(" ");
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
