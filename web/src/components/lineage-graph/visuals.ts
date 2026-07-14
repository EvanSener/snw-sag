import { Group, Object3D } from "three";
import SpriteText from "three-spritetext";
import type { SupportedLanguage } from "../../i18n";
import type {
  LineageEntityType,
  LineageRelationKind
} from "../../lib/lineage-graph-model";
import type { GraphLink, GraphNode } from "./types";

export const ENTITY_COLORS: Record<LineageEntityType, string> = {
  task: "#d97706",
  table: "#0284c7",
  column: "#16a34a"
};

export const RELATION_COLORS: Record<LineageRelationKind, string> = {
  "task-task": "#db2777",
  "task-table": "#ea580c",
  "table-table": "#0284c7",
  "table-column": "#65a30d",
  "column-column": "#7c3aed"
};

export function createNodeLabelObject(node: GraphNode, visible: boolean): Object3D {
  if (!visible) return new Object3D();
  const group = new Group();
  const sprite = new SpriteText(shortGraphName(node.name), node.type === "column" ? 2.5 : 3, "#0f172a");
  sprite.backgroundColor = "rgba(255, 255, 255, 0.94)";
  sprite.borderColor = ENTITY_COLORS[node.type];
  sprite.borderWidth = 0.35;
  sprite.borderRadius = 2;
  sprite.padding = [2.5, 1.2];
  sprite.fontFace = "Inter, system-ui, sans-serif";
  sprite.fontWeight = "600";
  sprite.position.set(0, 7.5, 0);
  group.add(sprite);
  return group;
}

export function createLinkLabelObject(link: GraphLink, language: SupportedLanguage, visible: boolean): Object3D {
  if (!visible) return new Object3D();
  const sprite = new SpriteText(relationDisplayName(link, language), 2.1, "#0f172a");
  sprite.backgroundColor = "rgba(255, 255, 255, 0.94)";
  sprite.padding = [2, 1];
  sprite.borderRadius = 2;
  return sprite;
}

export function positionLinkLabel(
  object: Object3D | undefined,
  coordinates: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }
): boolean {
  if (!object) return false;
  object.position.set(
    (coordinates.start.x + coordinates.end.x) / 2,
    (coordinates.start.y + coordinates.end.y) / 2,
    (coordinates.start.z + coordinates.end.z) / 2
  );
  return true;
}

export function nodeTooltip(node: GraphNode, language: SupportedLanguage): string {
  return `<div style="max-width:360px"><strong>${escapeHtml(node.name)}</strong><br/><span>${escapeHtml(entityTypeLabel(node.type, language))} · ${node.relationCount} ${escapeHtml(text(language, "条关系证据", "relation evidence"))}</span></div>`;
}

export function linkTooltip(link: GraphLink, language: SupportedLanguage): string {
  const context = link.contextTaskName
    ? `<br/><span>${escapeHtml(text(language, "任务", "Task"))}: ${escapeHtml(link.contextTaskName)}</span>`
    : "";
  return `<div><strong>${escapeHtml(relationDisplayName(link, language))}</strong>${context}<br/><span>${link.evidenceCount} ${escapeHtml(text(language, "条证据", "evidence"))}</span></div>`;
}

export function entityTypeLabel(type: LineageEntityType, language: SupportedLanguage): string {
  if (type === "task") return text(language, "任务", "Task");
  if (type === "table") return text(language, "表", "Table");
  return text(language, "字段", "Column");
}

export function relationKindLabel(kind: LineageRelationKind, language: SupportedLanguage): string {
  if (kind === "task-task") return text(language, "任务 - 任务", "Task - Task");
  if (kind === "task-table") return text(language, "任务 - 表", "Task - Table");
  if (kind === "table-table") return text(language, "表 - 表", "Table - Table");
  if (kind === "table-column") return text(language, "表 - 字段", "Table - Column");
  return text(language, "字段 - 字段", "Column - Column");
}

export function text(language: SupportedLanguage, zh: string, en: string): string {
  return language === "zh" ? zh : en;
}

function relationDisplayName(link: GraphLink, language: SupportedLanguage): string {
  if (link.type === "DEPENDS_ON") return text(language, "任务依赖", "Task dependency");
  if (link.type === "PRODUCES") return text(language, "产出", "Produces");
  if (link.type === "DATA_FLOW") return text(language, "数据流", "Data flow");
  if (link.type === "HAS_COLUMN") return text(language, "包含字段", "Has column");
  if (link.type === "SOURCE_FOR_COLUMN") return text(language, "字段来源表", "Source table");
  return link.type.replaceAll("_", " ");
}

function shortGraphName(name: string): string {
  if (name.length <= 54) return name;
  return `${name.slice(0, 25)}...${name.slice(-25)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
