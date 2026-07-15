import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import type { LineageLayoutPoint } from "./layout.js";
import { edgePointsToPath } from "./orthogonal-edge-path.js";

export interface OrthogonalLineageEdgeData extends Record<string, unknown> {
  points: LineageLayoutPoint[];
}

export type OrthogonalLineageFlowEdge = Edge<OrthogonalLineageEdgeData, "orthogonal">;

export function OrthogonalLineageEdge(props: EdgeProps<OrthogonalLineageFlowEdge>) {
  const points = props.data?.points?.length
    ? props.data.points
    : [
        { x: props.sourceX, y: props.sourceY },
        { x: props.targetX, y: props.targetY }
      ];
  const [labelX, labelY] = polylineMidpoint(points);
  return (
    <BaseEdge
      id={props.id}
      path={edgePointsToPath(points)}
      label={props.label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={props.labelStyle}
      labelShowBg={props.labelShowBg}
      labelBgStyle={props.labelBgStyle}
      labelBgPadding={props.labelBgPadding}
      labelBgBorderRadius={props.labelBgBorderRadius}
      markerStart={props.markerStart}
      markerEnd={props.markerEnd}
      interactionWidth={props.interactionWidth}
      style={props.style}
    />
  );
}

function polylineMidpoint(points: readonly LineageLayoutPoint[]): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return [points[0].x, points[0].y];
  const lengths = points.slice(1).map((point, index) => (
    Math.hypot(point.x - points[index].x, point.y - points[index].y)
  ));
  const halfLength = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (traversed + length >= halfLength) {
      const ratio = length === 0 ? 0 : (halfLength - traversed) / length;
      return [
        points[index].x + (points[index + 1].x - points[index].x) * ratio,
        points[index].y + (points[index + 1].y - points[index].y) * ratio
      ];
    }
    traversed += length;
  }
  const last = points[points.length - 1];
  return [last.x, last.y];
}
