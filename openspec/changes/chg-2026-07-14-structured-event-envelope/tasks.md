# Tasks: 结构化事件信封

## 1. 治理与测试

- [x] 1.1 初始化项目本地 OpenSpec、AGENTS、DESIGN 和 CI 入口。
- [x] 1.2 为有效信封、非法 JSON、非法实体类型和普通文档回退补充失败测试。

## 2. 实现

- [x] 2.1 将 chunk `rawContent` 传入事件 extractor。
- [x] 2.2 实现版本化信封解析、校验和确定性事件转换。
- [x] 2.3 增加 `task/table/column` 实体类型种子。

## 3. 验证与发布

- [x] 3.1 运行 `npm test`、`npm run typecheck`、`npm run build` 和 OpenSpec 检查。
- [x] 3.2 使用真实 SQL 血缘文档完成 API/UI live 验收。
- [ ] 3.3 提交并推送 `snw-sag`，等待远程 CI 通过。
