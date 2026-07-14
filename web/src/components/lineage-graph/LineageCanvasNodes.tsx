import { memo } from "react";
import {
  ChevronDown,
  ChevronUp,
  Columns3,
  Database,
  Loader2,
  Table2,
  Workflow
} from "lucide-react";
import {
  Handle,
  Position,
  type Node,
  type NodeProps
} from "@xyflow/react";
import type { SupportedLanguage } from "../../i18n.js";
import { cn } from "../../lib/utils.js";
import {
  fieldHandle,
  type LineageCanvasNode
} from "./canvas-model.js";
import { ENTITY_COLORS, text } from "./palette.js";

export interface LineageFlowNodeData extends LineageCanvasNode {
  [key: string]: unknown;
  language: SupportedLanguage;
  onSelectEntity: (entityId: string) => void;
  onToggleTable: (tableId: string) => void;
}

export type LineageFlowNode = Node<LineageFlowNodeData, "lineage">;

export const LineageCanvasNodeView = memo(function LineageCanvasNodeView(
  props: NodeProps<LineageFlowNode>
) {
  const { data } = props;
  if (data.kind === "table") return <TableNode data={data} />;
  if (data.kind === "task") return <TaskNode data={data} />;
  return <ColumnNode data={data} />;
});

function TaskNode({ data }: { data: LineageFlowNodeData }) {
  return (
    <NodeShell data={data} accent={ENTITY_COLORS.task}>
      <EntityHandles color={ENTITY_COLORS.task} />
      <div className="flex h-full items-center gap-3 px-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-amber-200 bg-amber-50 text-amber-700">
          {data.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Workflow className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase text-slate-400">
            {text(data.language, "SQL 任务", "SQL task")}
          </div>
          <div className="truncate text-xs font-semibold text-slate-900" title={data.name}>{data.title}</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            {data.relationCount} {text(data.language, "条关系", "relations")}
          </div>
        </div>
      </div>
    </NodeShell>
  );
}

function TableNode({ data }: { data: LineageFlowNodeData }) {
  const canToggle = data.totalColumnCount > 0 && (data.hiddenColumnCount > 0 || data.expanded);
  return (
    <NodeShell data={data} accent={ENTITY_COLORS.table}>
      <EntityHandles color={ENTITY_COLORS.table} />
      <div className="flex h-[68px] items-center gap-3 border-b border-slate-200 px-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-sky-200 bg-sky-50 text-sky-700">
          {data.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Table2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-[10px] text-slate-500">
            <Database className="h-3 w-3 shrink-0" />
            <span className="truncate" title={data.namespace}>{data.namespace || text(data.language, "数据表", "Table")}</span>
          </div>
          <div className="truncate text-xs font-semibold text-slate-900" title={data.name}>{data.title}</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">
            {data.totalColumnCount} {text(data.language, "字段", "columns")} · {data.relationCount} {text(data.language, "关系", "relations")}
          </div>
        </div>
      </div>

      <div>
        {data.columns.map((column) => (
          <button
            key={column.id}
            type="button"
            data-testid="lineage-field-row"
            data-column-id={column.id}
            className={cn(
              "nodrag nopan relative flex h-[30px] w-full items-center gap-2 border-b border-slate-100 px-3 text-left last:border-b-0 hover:bg-sky-50/70",
              column.selected && "bg-sky-50",
              !column.related && "opacity-35"
            )}
            onClick={(event) => {
              event.stopPropagation();
              data.onSelectEntity(column.id);
            }}
            title={column.fullName}
          >
            <Handle
              type="target"
              id={fieldHandle("target", column.id)}
              position={Position.Left}
              className="!left-[-5px] !h-2 !w-2 !border-2 !border-white !bg-emerald-600"
            />
            <Columns3 className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">{column.name}</span>
            <span className="shrink-0 text-[9px] tabular-nums text-slate-400">{column.relationCount}</span>
            <Handle
              type="source"
              id={fieldHandle("source", column.id)}
              position={Position.Right}
              className="!right-[-5px] !h-2 !w-2 !border-2 !border-white !bg-emerald-600"
            />
          </button>
        ))}
      </div>

      {data.hiddenColumnCount > 0 || data.expanded ? (
        <button
          type="button"
          data-testid="lineage-table-fields-toggle"
          className={cn(
            "nodrag nopan flex h-[30px] w-full items-center justify-between gap-2 border-t border-slate-100 px-3 text-[10px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800",
            !canToggle && "cursor-default"
          )}
          disabled={!canToggle}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleTable(data.entityId);
          }}
        >
          <span>
            {data.hiddenColumnCount > 0
              ? text(data.language, `还有 ${data.hiddenColumnCount} 个字段`, `${data.hiddenColumnCount} more columns`)
              : text(data.language, "字段已展开", "Columns expanded")}
          </span>
          {data.expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      ) : null}
    </NodeShell>
  );
}

function ColumnNode({ data }: { data: LineageFlowNodeData }) {
  return (
    <NodeShell data={data} accent={ENTITY_COLORS.column}>
      <EntityHandles color={ENTITY_COLORS.column} />
      <div className="flex h-full items-center gap-3 px-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-emerald-200 bg-emerald-50 text-emerald-700">
          {data.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Columns3 className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase text-slate-400">
            {text(data.language, "未归属字段", "Unowned column")}
          </div>
          <div className="truncate text-xs font-semibold text-slate-900" title={data.name}>{data.title}</div>
        </div>
      </div>
    </NodeShell>
  );
}

function NodeShell(props: {
  data: LineageFlowNodeData;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={`lineage-node-${props.data.kind}`}
      data-entity-id={props.data.entityId}
      className={cn(
        "h-full w-full overflow-hidden rounded-md border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-[border-color,box-shadow,opacity]",
        props.data.selected
          ? "border-slate-900 shadow-[0_0_0_2px_rgba(15,23,42,0.12),0_8px_20px_rgba(15,23,42,0.12)]"
          : "border-slate-300",
        !props.data.related && "opacity-30 grayscale-[0.35]"
      )}
      style={{ borderLeftColor: props.accent, borderLeftWidth: 3 }}
    >
      {props.children}
    </div>
  );
}

function EntityHandles({ color }: { color: string }) {
  return (
    <>
      <Handle
        type="target"
        id="entity-target"
        position={Position.Left}
        className="!left-[-5px] !h-2.5 !w-2.5 !border-2 !border-white"
        style={{ backgroundColor: color }}
      />
      <Handle
        type="source"
        id="entity-source"
        position={Position.Right}
        className="!right-[-5px] !h-2.5 !w-2.5 !border-2 !border-white"
        style={{ backgroundColor: color }}
      />
    </>
  );
}
