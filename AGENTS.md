# AGENTS.md

## 项目定位

本仓库是 [Zleap-AI/SAG](https://github.com/Zleap-AI/SAG) 的兼容分支，只为需要确定性事件与实体的结构化摄取场景增加小型扩展。普通 Markdown/TXT、WebUI、搜索和 MCP 行为必须继续兼容上游。

## 开始前

1. 先阅读 `README.md` 和上游 `README-CN.md`。
2. 再阅读 `openspec/specs/` 与 `openspec/changes/` 中未归档的 change。
3. 新行为或跨模块修改必须先更新 OpenSpec 工件。

## 硬性边界

1. 结构化事件信封必须显式校验；已声明 schema 的无效信封不得静默回退到 LLM 或本地文本猜测。
2. `snw.sql_lineage_event.v1` 只允许 `task`、`table`、`column` 实体类型。
3. 未携带结构化信封的普通文档继续使用上游原有抽取流程。
4. 不修改 SAG 搜索算法、通用事件模型和普通文档语义，除非新的 OpenSpec 明确批准。
5. 保持与上游同步友好，扩展代码应局部化并附测试。

## 工程规则

1. Node.js 20+，依赖使用 npm 和仓库锁文件。
2. 新行为采用 TDD，先确认失败测试，再做最小实现。
3. TypeScript 必须通过测试、类型检查和生产构建。
4. 用户文档与项目约束默认使用中文；协议字段与代码标识符保留英文。

## 验证命令

```bash
npm test
npm run typecheck
npm run build
node scripts/openspec-ci-check.mjs
```
