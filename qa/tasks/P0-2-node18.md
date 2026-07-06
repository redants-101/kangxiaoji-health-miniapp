## 任务：P0-2 云函数运行时升级 Node.js 18

- 级别：P0
- 影响范围：`cloudbaserc.json`、`cloudfunctions/healthApi/*`
- 功能点：
  1. 将云函数运行时从 `Nodejs16.13` 升级到 `Nodejs18.x`
  2. 验证云函数代码在 Node.js 18 下的兼容性
  3. 更新 `cloudbaserc.json` 配置
- 技术难点：
  1. Node.js 18 移除了部分已弃用 API（如 `new Buffer()`），需确认云函数代码未使用
  2. 云函数代码未纳入版本控制，需先获取审查
  3. 升级后冷启动行为可能变化，需验证首请求延迟
- 验收标准：
  1. `cloudbaserc.json` 中 `runtime` 字段为 `Nodejs18.x`
  2. 所有云函数接口（health-api-regression.js 覆盖的）正常工作
  3. 冷启动延迟不超过升级前的 1.2 倍
  4. 回归测试全部通过
- 回归风险：
  - Node.js 运行时变更可能导致云函数冷启动延迟增加
  - 部分第三方依赖可能不兼容 Node.js 18
- 关联任务：P3-1 云函数拆分（后续可基于 Node.js 18 优化）
