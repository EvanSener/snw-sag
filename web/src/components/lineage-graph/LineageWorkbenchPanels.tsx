import type { ReactNode } from "react";
import {
  Columns3,
  Eye,
  EyeOff,
  Focus,
  Loader2,
  Network,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  Tags,
  Workflow,
  X
} from "lucide-react";
import type { SupportedLanguage } from "../../i18n.js";
import {
  LINEAGE_ENTITY_TYPES,
  LINEAGE_RELATION_KINDS,
  type LineageEntityType,
  type LineageRelationKind
} from "../../lib/lineage-graph-model.js";
import { cn } from "../../lib/utils.js";
import type { LineageGraphNodeRecord } from "../../types.js";
import { Button } from "../ui/button.js";
import {
  ENTITY_COLORS,
  RELATION_COLORS,
  entityTypeLabel,
  relationKindLabel,
  text
} from "./palette.js";

export function LineageExplorerPanel(props: {
  variant: "rail" | "overlay";
  language: SupportedLanguage;
  nodeCount: number;
  edgeCount: number;
  entityVisibility: Record<LineageEntityType, boolean>;
  relationVisibility: Record<LineageRelationKind, boolean>;
  showRelationLabels: boolean;
  traversalDepth: number;
  onToggleEntity: (type: LineageEntityType) => void;
  onToggleRelation: (kind: LineageRelationKind) => void;
  onToggleRelationLabels: () => void;
  onTraversalDepthChange: (depth: number) => void;
  onReset: () => void;
  onClose?: () => void;
}) {
  return (
    <aside className={cn(
      "z-20 overflow-y-auto bg-white text-slate-900 scrollbar-thin",
      props.variant === "rail"
        ? "relative hidden h-full w-[248px] shrink-0 border-r border-slate-200 lg:block"
        : "absolute bottom-3 left-3 top-14 w-[min(288px,calc(100%-24px))] border border-slate-200 shadow-xl lg:hidden"
    )}>
      <div className="flex h-12 items-center justify-between gap-2 border-b border-slate-200 px-4">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <SlidersHorizontal className="h-4 w-4 text-sky-700" />
          {text(props.language, "血缘视图", "Lineage view")}
        </div>
        <div className="flex items-center gap-1">
          <PanelIconButton title={text(props.language, "恢复默认", "Restore defaults")} onClick={props.onReset}>
            <RotateCcw className="h-3.5 w-3.5" />
          </PanelIconButton>
          {props.variant === "overlay" && props.onClose ? (
            <PanelIconButton title={text(props.language, "关闭", "Close")} onClick={props.onClose}>
              <X className="h-3.5 w-3.5" />
            </PanelIconButton>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-slate-200">
        <Metric value={props.nodeCount} label={text(props.language, "实体", "Entities")} />
        <Metric value={props.edgeCount} label={text(props.language, "关系", "Relations")} />
      </div>

      <section className="px-4 py-4">
        <SectionTitle>{text(props.language, "实体类型", "Entity types")}</SectionTitle>
        <div className="mt-2">
          {LINEAGE_ENTITY_TYPES.map((type) => (
            <div key={type} className="flex h-9 items-center justify-between border-b border-slate-100 last:border-0">
              <span className="flex items-center gap-2 text-xs font-medium">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ENTITY_COLORS[type] }} />
                {entityTypeLabel(type, props.language)}
              </span>
              <VisibilityButton
                checked={props.entityVisibility[type]}
                label={text(props.language, `显示${entityTypeLabel(type, props.language)}`, `Show ${entityTypeLabel(type, props.language)}`)}
                onClick={() => props.onToggleEntity(type)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 px-4 py-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{text(props.language, "关系类型", "Relation types")}</SectionTitle>
          <PanelIconButton
            active={props.showRelationLabels}
            title={text(props.language, "切换关系标签", "Toggle relation labels")}
            onClick={props.onToggleRelationLabels}
          >
            <Tags className="h-3.5 w-3.5" />
          </PanelIconButton>
        </div>
        <div className="mt-2">
          {LINEAGE_RELATION_KINDS.map((kind) => (
            <div key={kind} className="flex min-h-9 items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-0">
              <span className="flex min-w-0 items-center gap-2 text-[11px] font-medium">
                <span className="h-0.5 w-5 shrink-0" style={{ backgroundColor: RELATION_COLORS[kind] }} />
                <span>{relationKindLabel(kind, props.language)}</span>
              </span>
              <VisibilityButton
                checked={props.relationVisibility[kind]}
                label={text(props.language, `显示${relationKindLabel(kind, props.language)}`, `Show ${relationKindLabel(kind, props.language)}`)}
                onClick={() => props.onToggleRelation(kind)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 px-4 py-4">
        <SectionTitle>{text(props.language, "穿透层级", "Traversal depth")}</SectionTitle>
        <div className="mt-3 grid grid-cols-5 overflow-hidden rounded border border-slate-200">
          {[1, 2, 3, 4, 5].map((depth) => (
            <button
              key={depth}
              type="button"
              className={cn(
                "h-8 border-r border-slate-200 text-xs font-semibold tabular-nums last:border-r-0 hover:bg-slate-50",
                props.traversalDepth === depth ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-white text-slate-600"
              )}
              aria-pressed={props.traversalDepth === depth}
              onClick={() => props.onTraversalDepthChange(depth)}
            >
              {depth}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

export interface LineageInspectorRelation {
  id: string;
  direction: "incoming" | "outgoing";
  label: string;
  otherName: string;
  evidenceCount: number;
  eventId: string | null;
  color: string;
}

export function LineageInspectorPanel(props: {
  variant: "rail" | "overlay";
  language: SupportedLanguage;
  node: LineageGraphNodeRecord | null;
  nodeCount: number;
  edgeCount: number;
  loading: boolean;
  expanded: boolean;
  highlightedNodeCount: number;
  highlightedEdgeCount: number;
  relations: LineageInspectorRelation[];
  onFocus: () => void;
  onExpand: () => void;
  onOpen: () => void;
  onOpenEvent: (eventId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside
      data-testid="lineage-selected-node-panel"
      className={cn(
        "z-20 overflow-y-auto bg-white text-slate-900 scrollbar-thin",
        props.variant === "rail"
          ? "relative hidden h-full w-[300px] shrink-0 border-l border-slate-200 2xl:block"
          : "absolute bottom-3 right-3 max-h-[min(520px,calc(100%-68px))] w-[min(340px,calc(100%-24px))] border border-slate-200 shadow-xl 2xl:hidden"
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
        <span className="text-xs font-semibold">{text(props.language, "血缘检查器", "Lineage inspector")}</span>
        {props.node ? (
          <PanelIconButton title={text(props.language, "清除选择", "Clear selection")} onClick={props.onClose}>
            <X className="h-3.5 w-3.5" />
          </PanelIconButton>
        ) : null}
      </div>

      {props.node ? (
        <SelectedInspector {...props} node={props.node} />
      ) : (
        <div>
          <div className="grid grid-cols-2 border-b border-slate-200">
            <Metric value={props.nodeCount} label={text(props.language, "可见实体", "Visible entities")} />
            <Metric value={props.edgeCount} label={text(props.language, "可见关系", "Visible relations")} />
          </div>
          <div className="space-y-3 p-4">
            {LINEAGE_ENTITY_TYPES.map((type) => (
              <div key={type} className="flex h-9 items-center justify-between border-b border-slate-100 text-xs last:border-0">
                <span className="flex items-center gap-2 font-medium">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ENTITY_COLORS[type] }} />
                  {entityTypeLabel(type, props.language)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function SelectedInspector(props: Parameters<typeof LineageInspectorPanel>[0] & { node: LineageGraphNodeRecord }) {
  const Icon = props.node.type === "task" ? Workflow : props.node.type === "table" ? Table2 : Columns3;
  return (
    <div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-slate-50"
            style={{ color: ENTITY_COLORS[props.node.type], borderColor: `${ENTITY_COLORS[props.node.type]}40` }}
          >
            {props.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase text-slate-400">{entityTypeLabel(props.node.type, props.language)}</div>
            <div className="break-all text-xs font-semibold leading-5 text-slate-900" title={props.node.name}>{props.node.name}</div>
            <div className="mt-1 text-[10px] tabular-nums text-slate-500">
              {props.node.relationCount} {text(props.language, "条关系证据", "relation evidence")}
            </div>
          </div>
        </div>
      </div>

      <div
        data-testid="lineage-highlight-counts"
        data-node-count={props.highlightedNodeCount}
        data-edge-count={props.highlightedEdgeCount}
        className="grid grid-cols-2 border-y border-slate-200"
      >
        <Metric value={props.highlightedNodeCount} label={text(props.language, "关联实体", "Related entities")} />
        <Metric value={props.highlightedEdgeCount} label={text(props.language, "关联关系", "Related relations")} />
      </div>

      <div className="flex gap-2 border-b border-slate-200 p-3">
        <Button className="h-8 flex-1 text-xs" variant="outline" size="sm" onClick={props.onFocus}>
          <Focus className="h-3.5 w-3.5" />
          {text(props.language, "聚焦", "Focus")}
        </Button>
        <Button className="h-8 flex-1 text-xs" variant="outline" size="sm" disabled={props.loading || props.expanded} onClick={props.onExpand}>
          {props.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
          {props.expanded ? text(props.language, "已展开", "Expanded") : text(props.language, "展开", "Expand")}
        </Button>
        <Button className="h-8 flex-1 text-xs" size="sm" onClick={props.onOpen}>
          {text(props.language, "详情", "Details")}
        </Button>
      </div>

      <div className="p-4">
        <SectionTitle>{text(props.language, "直接关系", "Direct relations")}</SectionTitle>
        <div className="mt-2 space-y-1">
          {props.relations.length > 0 ? props.relations.map((relation) => (
            <button
              key={relation.id}
              type="button"
              className="flex w-full items-start gap-2 rounded border border-transparent px-2 py-2 text-left hover:border-slate-200 hover:bg-slate-50 disabled:cursor-default"
              disabled={!relation.eventId}
              onClick={() => relation.eventId && props.onOpenEvent(relation.eventId)}
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: relation.color }} />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">
                  {relation.direction === "incoming" ? "←" : "→"} {relation.label}
                </span>
                <span className="block truncate text-[11px] font-medium text-slate-700" title={relation.otherName}>{relation.otherName}</span>
              </span>
              <span className="shrink-0 text-[9px] tabular-nums text-slate-400">{relation.evidenceCount}</span>
            </button>
          )) : (
            <div className="h-10 border-b border-slate-100" />
          )}
        </div>
      </div>
    </div>
  );
}

export function GraphIconButton(props: {
  type?: "button" | "submit";
  title: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40",
        props.active && "border-sky-300 bg-sky-50 text-sky-700"
      )}
    >
      {props.children}
    </button>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-r border-slate-200 px-4 py-3 last:border-r-0">
      <div className="text-base font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="text-[10px] font-medium text-slate-500">{label}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase text-slate-400">{children}</div>;
}

function VisibilityButton(props: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.checked}
      aria-label={props.label}
      title={props.label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded border",
        props.checked
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-slate-200 bg-white text-slate-400 hover:text-slate-700"
      )}
      onClick={props.onClick}
    >
      {props.checked ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
    </button>
  );
}

function PanelIconButton(props: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
        props.active && "border-sky-300 bg-sky-50 text-sky-700"
      )}
    >
      {props.children}
    </button>
  );
}
