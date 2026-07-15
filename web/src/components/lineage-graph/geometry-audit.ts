export const LINEAGE_GEOMETRY_EPSILON = 0.5;

export interface GeometryPoint {
  x: number;
  y: number;
}

export interface RoutedGeometryEdge {
  id: string;
  points: GeometryPoint[];
}

export function partitionNonCrossingEdges<T extends RoutedGeometryEdge>(
  edges: readonly T[],
  epsilon = LINEAGE_GEOMETRY_EPSILON
): { edges: T[]; bundledEdgeIds: string[] } {
  const accepted: T[] = [];
  const bundledEdgeIds: string[] = [];

  for (const edge of edges) {
    if (edge.points.length < 2 || accepted.some((other) => routesConflict(other.points, edge.points, epsilon))) {
      bundledEdgeIds.push(edge.id);
    } else {
      accepted.push(edge);
    }
  }

  return { edges: accepted, bundledEdgeIds };
}

export function routesConflict(
  left: readonly GeometryPoint[],
  right: readonly GeometryPoint[],
  epsilon = LINEAGE_GEOMETRY_EPSILON
): boolean {
  if (left.length < 2 || right.length < 2) return false;
  for (let leftIndex = 1; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex < right.length; rightIndex += 1) {
      if (segmentsConflict(
        left[leftIndex - 1],
        left[leftIndex],
        right[rightIndex - 1],
        right[rightIndex],
        left,
        right,
        epsilon
      )) return true;
    }
  }
  return false;
}

function segmentsConflict(
  leftStart: GeometryPoint,
  leftEnd: GeometryPoint,
  rightStart: GeometryPoint,
  rightEnd: GeometryPoint,
  leftRoute: readonly GeometryPoint[],
  rightRoute: readonly GeometryPoint[],
  epsilon: number
): boolean {
  const leftHorizontal = Math.abs(leftStart.y - leftEnd.y) <= epsilon;
  const leftVertical = Math.abs(leftStart.x - leftEnd.x) <= epsilon;
  const rightHorizontal = Math.abs(rightStart.y - rightEnd.y) <= epsilon;
  const rightVertical = Math.abs(rightStart.x - rightEnd.x) <= epsilon;

  if (leftHorizontal && rightHorizontal) {
    if (Math.abs(leftStart.y - rightStart.y) > epsilon) return false;
    return parallelSegmentsConflict(
      leftStart.x,
      leftEnd.x,
      rightStart.x,
      rightEnd.x,
      { x: contactCoordinate(leftStart.x, leftEnd.x, rightStart.x, rightEnd.x), y: (leftStart.y + rightStart.y) / 2 },
      leftRoute,
      rightRoute,
      epsilon
    );
  }

  if (leftVertical && rightVertical) {
    if (Math.abs(leftStart.x - rightStart.x) > epsilon) return false;
    return parallelSegmentsConflict(
      leftStart.y,
      leftEnd.y,
      rightStart.y,
      rightEnd.y,
      { x: (leftStart.x + rightStart.x) / 2, y: contactCoordinate(leftStart.y, leftEnd.y, rightStart.y, rightEnd.y) },
      leftRoute,
      rightRoute,
      epsilon
    );
  }

  if (leftHorizontal && rightVertical) {
    return perpendicularSegmentsConflict(
      leftStart,
      leftEnd,
      rightStart,
      rightEnd,
      leftRoute,
      rightRoute,
      epsilon
    );
  }

  if (leftVertical && rightHorizontal) {
    return perpendicularSegmentsConflict(
      rightStart,
      rightEnd,
      leftStart,
      leftEnd,
      rightRoute,
      leftRoute,
      epsilon
    );
  }

  return genericSegmentsConflict(
    leftStart,
    leftEnd,
    rightStart,
    rightEnd,
    leftRoute,
    rightRoute,
    epsilon
  );
}

function parallelSegmentsConflict(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
  contact: GeometryPoint,
  leftRoute: readonly GeometryPoint[],
  rightRoute: readonly GeometryPoint[],
  epsilon: number
): boolean {
  const leftMin = Math.min(leftStart, leftEnd);
  const leftMax = Math.max(leftStart, leftEnd);
  const rightMin = Math.min(rightStart, rightEnd);
  const rightMax = Math.max(rightStart, rightEnd);
  const overlap = Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin);
  if (overlap < -epsilon) return false;
  if (overlap > epsilon) return true;
  return !isSharedRouteEndpoint(contact, leftRoute, rightRoute, epsilon);
}

function perpendicularSegmentsConflict(
  horizontalStart: GeometryPoint,
  horizontalEnd: GeometryPoint,
  verticalStart: GeometryPoint,
  verticalEnd: GeometryPoint,
  horizontalRoute: readonly GeometryPoint[],
  verticalRoute: readonly GeometryPoint[],
  epsilon: number
): boolean {
  const contact = { x: verticalStart.x, y: horizontalStart.y };
  if (!within(contact.x, horizontalStart.x, horizontalEnd.x, epsilon)
    || !within(contact.y, verticalStart.y, verticalEnd.y, epsilon)) return false;
  return !isSharedRouteEndpoint(contact, horizontalRoute, verticalRoute, epsilon);
}

function genericSegmentsConflict(
  leftStart: GeometryPoint,
  leftEnd: GeometryPoint,
  rightStart: GeometryPoint,
  rightEnd: GeometryPoint,
  leftRoute: readonly GeometryPoint[],
  rightRoute: readonly GeometryPoint[],
  epsilon: number
): boolean {
  const leftA = orientation(leftStart, leftEnd, rightStart);
  const leftB = orientation(leftStart, leftEnd, rightEnd);
  const rightA = orientation(rightStart, rightEnd, leftStart);
  const rightB = orientation(rightStart, rightEnd, leftEnd);
  if (!((leftA <= epsilon && leftB >= -epsilon) || (leftA >= -epsilon && leftB <= epsilon))) return false;
  if (!((rightA <= epsilon && rightB >= -epsilon) || (rightA >= -epsilon && rightB <= epsilon))) return false;

  const sharedEndpoint = [leftRoute[0], leftRoute[leftRoute.length - 1]].find((point) => (
    [rightRoute[0], rightRoute[rightRoute.length - 1]].some((candidate) => samePoint(point, candidate, epsilon))
  ));
  return !sharedEndpoint;
}

function isSharedRouteEndpoint(
  point: GeometryPoint,
  leftRoute: readonly GeometryPoint[],
  rightRoute: readonly GeometryPoint[],
  epsilon: number
): boolean {
  const leftEndpoint = samePoint(point, leftRoute[0], epsilon)
    || samePoint(point, leftRoute[leftRoute.length - 1], epsilon);
  const rightEndpoint = samePoint(point, rightRoute[0], epsilon)
    || samePoint(point, rightRoute[rightRoute.length - 1], epsilon);
  return leftEndpoint && rightEndpoint;
}

function contactCoordinate(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  return (Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd))
    + Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd))) / 2;
}

function within(value: number, start: number, end: number, epsilon: number): boolean {
  return value >= Math.min(start, end) - epsilon && value <= Math.max(start, end) + epsilon;
}

function orientation(start: GeometryPoint, end: GeometryPoint, point: GeometryPoint): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function samePoint(left: GeometryPoint, right: GeometryPoint, epsilon: number): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}
