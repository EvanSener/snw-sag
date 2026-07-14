import type { LineageRelationKind } from "../../lib/lineage-graph-model";
import type {
  LineageGraphEdgeRecord,
  LineageGraphNodeRecord
} from "../../types";

export type GraphNode = LineageGraphNodeRecord & {
  x?: number;
  y?: number;
  z?: number;
};

export type GraphLink = LineageGraphEdgeRecord & {
  source: string | GraphNode;
  target: string | GraphNode;
  relationKind: LineageRelationKind;
};
