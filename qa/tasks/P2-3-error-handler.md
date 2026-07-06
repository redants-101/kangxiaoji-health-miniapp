## 任务：P2-3 统一错误处理体系

- 级别：P2
- 影响范围：新增 `utils/error-handler.js`、`utils/page-factory.js`、所有页面的 `catch` 块
- 功能点：
  1. 创建 `utils/error-handler.js`，统一错误分类（网络/权限/数据/系统）和用户提示文案映射
  2. 云函数错误信息脱敏：内部错误记录到日志，用户看到友好提示
  3. 所有页面的 `catch` 块统一使用 `error-handler` 处理
  4. 关键错误使用 `notice` 组件持久展示，而非 `wx.showToast`
- 技术难点：
  1. 需逐页面审查现有 `catch` 块，统一替换为 `error-handler` 调用
  2. 错误分类需覆盖所有已知错误类型，且可扩展
  3. 脱敏规则需平衡信息量和安全性，不能完全隐藏错误详情
- 验收标准：
  1. `error-handler.js` 导出 `handleError(error, context)` 方法
  2. 错误分类：network / permission / data / system / unknown
  3. 用户提示文案不包含云函数名、环境 ID、内部错误码
  4. 所有页面 `catch` 块使用 `handleError` 替代直接 `wx.showToast`
  5. 关键错误（云函数调用失败、数据损坏）使用持久展示
  6. ESLint 规则检测直接使用 `wx.showToast` 展示错误的代码
- 回归风险：
  - 错误提示文案变更可能影响用户对问题的理解
  - 脱敏过度可能导致开发者难以排查问题
- 关联任务：无
