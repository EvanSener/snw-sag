import type { SupportedLanguage } from "../../i18n.js";
import type {
  LineageEntityType,
  LineageRelationKind
} from "../../lib/lineage-graph-model.js";

export const ENTITY_COLORS: Record<LineageEntityType, string> = {
  task: "#b45309",
  table: "#0369a1",
  column: "#15803d"
};

export const RELATION_COLORS: Record<LineageRelationKind, string> = {
  "task-task": "#be185d",
  "task-table": "#c2410c",
  "table-table": "#0369a1",
  "table-column": "#4d7c0f",
  "column-column": "#6d28d9"
};

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
