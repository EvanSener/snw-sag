import type { ReactNode } from "react";
import {
  Columns3,
  Eye,
  EyeOff,
  Focus,
  Loader2,
  Minus,
  Network,
  PanelLeftClose,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  Tags,
  Workflow,
  X
} from "lucide-react";
import type { SupportedLanguage } from "../../i18n";
import {
  LINEAGE_ENTITY_TYPES,
  LINEAGE_RELATION_KINDS,
  type LineageEntityType,
  type LineageRelationKind
} from "../../lib/lineage-graph-model";
import { cn } from "../../lib/utils";
import type { LineageGraphNodeRecord } from "../../types";
import { Button } from "../ui/button";
import {
  ENTITY_COLORS,
  RELATION_COLORS,
  entityTypeLabel,
  relationKindLabel,
  text
} from "./visuals";

export function GraphFilterPanel(props: {
  className?: string;
  language: SupportedLanguage;
  entityVisibility: Record<LineageEntityType, boolean>;
  labelVisibility: Record<LineageEntityType, boolean>;
  relationVisibility: Record<LineageRelationKind, boolean>;
  showRelationLabels: boolean;
  onToggleEntity: (type: LineageEntityType) => void;
  onToggleLabel: (type: LineageEntityType) => void;
  onToggleRelation: (kind: LineageRelationKind) => void;
  onToggleRelationLabels: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <aside className={cn("absolute bottom-3 left-3 top-14 z-10 w-[276px] overflow-y-auto border border-slate-200 bg-white/96 p-3 text-slate-900 shadow-xl backdrop-blur-sm scrollbar-thin md:bottom-auto md:max-h-[calc(100%-68px)]", props.className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="h-4 w-4 text-cyan-700" />
          {text(props.language, "图谱显示", "Graph display")}
        </div>
        <div className="flex items-center gap-1">
          <PanelIconButton onClick={props.onReset} title={text(props.language, "恢复默认", "Restore defaults")}>
            <RotateCcw className="h-4 w-4" />
          </PanelIconButton>
          <PanelIconButton className="md:hidden" onClick={props.onClose} title={text(props.language, "关闭", "Close")}>
            <PanelLeftClose className="h-4 w-4" />
          </PanelIconButton>
        </div>
      </div>

      <section className="pt-3">
        <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase text-slate-400">
          <span>{text(props.language, "实体", "Entities")}</span>
          <span className="flex items-center gap-3">
            <span>{text(props.language, "节点", "Node")}</span>
            <span>{text(props.language, "标签", "Label")}</span>
          </span>
        </div>
        <div className="space-y-1">
          {LINEAGE_ENTITY_TYPES.map((type) => (
            <div key={type} className="flex h-9 items-center justify-between gap-2 border-b border-slate-200 last:border-0">
              <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ENTITY_COLORS[type], boxShadow: `0 0 0 2px ${ENTITY_COLORS[type]}24` }} />
                <span>{entityTypeLabel(type, props.language)}</span>
              </span>
              <span className="flex items-center gap-2">
                <VisibilityToggle
                  checked={props.entityVisibility[type]}
                  label={text(props.language, `显示${entityTypeLabel(type, props.language)}节点`, `Show ${entityTypeLabel(type, props.language)} nodes`)}
                  onChange={() => props.onToggleEntity(type)}
                />
                <PanelIconButton
                  active={props.labelVisibility[type]}
                  onClick={() => props.onToggleLabel(type)}
                  title={text(props.language, `切换${entityTypeLabel(type, props.language)}标签`, `Toggle ${entityTypeLabel(type, props.language)} labels`)}
                >
                  {props.labelVisibility[type] ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </PanelIconButton>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase text-slate-400">{text(props.language, "关系", "Relations")}</span>
          <PanelIconButton
            active={props.showRelationLabels}
            onClick={props.onToggleRelationLabels}
            title={text(props.language, "切换关系标签", "Toggle relation labels")}
          >
            <Tags className="h-3.5 w-3.5" />
          </PanelIconButton>
        </div>
        <div className="space-y-1">
          {LINEAGE_RELATION_KINDS.map((kind) => (
            <label key={kind} className="flex h-8 cursor-pointer items-center justify-between gap-2 border-b border-slate-200 text-xs last:border-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-0.5 w-5 shrink-0" style={{ backgroundColor: RELATION_COLORS[kind] }} />
                <span>{relationKindLabel(kind, props.language)}</span>
              </span>
              <VisibilityToggle
                checked={props.relationVisibility[kind]}
                label={text(props.language, `显示${relationKindLabel(kind, props.language)}关系`, `Show ${relationKindLabel(kind, props.language)} relations`)}
                onChange={() => props.onToggleRelation(kind)}
              />
            </label>
          ))}
        </div>
      </section>
    </aside>
  );
}

export function SelectedNodePanel(props: {
  node: LineageGraphNodeRecord;
  language: SupportedLanguage;
  loading: boolean;
  expanded: boolean;
  traversalDepth: number;
  highlightedNodeCount: number;
  highlightedEdgeCount: number;
  onFocus: () => void;
  onExpand: () => void;
  onTraversalDepthChange: (depth: number) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const Icon = props.node.type === "task" ? Workflow : props.node.type === "table" ? Table2 : Columns3;
  return (
    <aside data-testid="lineage-selected-node-panel" className="absolute bottom-3 right-3 z-10 w-[min(340px,calc(100%-24px))] border border-slate-200 bg-white/96 p-3 text-slate-900 shadow-xl backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-slate-200 bg-slate-50" style={{ color: ENTITY_COLORS[props.node.type] }}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase text-slate-400">{entityTypeLabel(props.node.type, props.language)}</div>
          <div className="break-all text-xs font-semibold leading-5" title={props.node.name}>{props.node.name}</div>
          <div className="mt-1 text-[11px] text-slate-500">{props.node.relationCount} {text(props.language, "条关系证据", "relation evidence")}</div>
        </div>
        <PanelIconButton onClick={props.onClose} title={text(props.language, "关闭", "Close")}>
          <X className="h-4 w-4" />
        </PanelIconButton>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase text-slate-500">{text(props.language, "穿透层级", "Traversal depth")}</div>
          <div
            data-testid="lineage-highlight-counts"
            data-node-count={props.highlightedNodeCount}
            data-edge-count={props.highlightedEdgeCount}
            className="mt-0.5 text-[11px] text-slate-500"
          >
            {props.highlightedNodeCount} {text(props.language, "实体", "entities")} / {props.highlightedEdgeCount} {text(props.language, "关系", "relations")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PanelIconButton
            disabled={props.traversalDepth <= 1}
            onClick={() => props.onTraversalDepthChange(props.traversalDepth - 1)}
            title={text(props.language, "减少穿透层级", "Decrease traversal depth")}
          >
            <Minus className="h-3.5 w-3.5" />
          </PanelIconButton>
          <span
            className="flex h-7 min-w-11 items-center justify-center border border-slate-200 bg-slate-50 px-2 text-xs font-semibold tabular-nums text-slate-700"
            aria-label={text(props.language, `当前穿透 ${props.traversalDepth} 层`, `Current traversal depth ${props.traversalDepth}`)}
          >
            {props.traversalDepth} {text(props.language, "层", "hop")}
          </span>
          <PanelIconButton
            disabled={props.traversalDepth >= 5}
            onClick={() => props.onTraversalDepthChange(props.traversalDepth + 1)}
            title={text(props.language, "增加穿透层级", "Increase traversal depth")}
          >
            <Plus className="h-3.5 w-3.5" />
          </PanelIconButton>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3">
        <Button className="h-8 border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50" variant="outline" size="sm" onClick={props.onFocus}>
          <Focus className="h-3.5 w-3.5" />
          {text(props.language, "聚焦", "Focus")}
        </Button>
        <Button className="h-8 border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50" variant="outline" size="sm" disabled={props.loading || props.expanded} onClick={props.onExpand}>
          {props.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
          {props.expanded ? text(props.language, "已展开", "Expanded") : text(props.language, "展开", "Expand")}
        </Button>
        <Button className="h-8 text-xs" size="sm" onClick={props.onOpen}>
          {text(props.language, "详情", "Details")}
        </Button>
      </div>
    </aside>
  );
}

export function GraphIconButton(props: {
  type: "button" | "submit";
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={props.type}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
      className="flex h-9 w-9 shrink-0 items-center justify-center border border-slate-300 bg-white/95 text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

function VisibilityToggle(props: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      title={props.label}
      className={cn(
        "relative h-4 w-7 rounded-full border transition-colors",
        props.checked ? "border-cyan-700 bg-cyan-600" : "border-slate-300 bg-slate-100"
      )}
      onClick={props.onChange}
    >
      <span className={cn(
        "absolute left-0 top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform",
        props.checked ? "translate-x-3" : "translate-x-0.5"
      )} />
    </button>
  );
}

function PanelIconButton(props: {
  className?: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      className={cn(
        "flex h-7 w-7 items-center justify-center border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35",
        props.active && "border-cyan-300 bg-cyan-50 text-cyan-700",
        props.className
      )}
    >
      {props.children}
    </button>
  );
}
