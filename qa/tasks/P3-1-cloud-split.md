## 任务：P3-1 云函数拆分（读写分离）

- 级别：P3
- 影响范围：`cloudfunctions/healthApi/*`、`cloudbaserc.json`、`services/core.js`、`utils/api-config.js`
- 功能点：
  1. 将单一云函数 `healthApi` 拆分为 `healthRead`（高频低延迟）和 `healthWrite`（低频可容忍延迟）
  2. 读函数优化冷启动：减少依赖，降低包体积
  3. 写函数增加更严格的校验和日志
  4. 前端 `requestCloudByKey` 路由到 `healthRead`，`requestCloud` 路由到 `healthWrite`
- 技术难点：
  1. 云函数拆分需确保读写操作的正确路由
  2. 两个函数的共享逻辑（如数据库操作、权限校验）需抽取为公共层
  3. 拆分后需更新 `cloudbaserc.json` 和 `api-config.js` 配置
  4. 冷启动优化需分析读函数的依赖链
- 验收标准：
  1. `cloudbaserc.json` 包含 `healthRead` 和 `healthWrite` 两个函数配置
  2. 读操作（getHomeData、getRecordListData 等）路由到 `healthRead`
  3. 写操作（saveBloodPressureRecord 等）路由到 `healthWrite`
  4. `healthRead` 冷启动延迟 < 500ms
  5. 云函数回归测试通过
  6. 前端代码无感知变更（`api.js` 接口不变）
- 回归风险：
  - 云函数拆分可能导致部分操作路由错误
  - 冷启动延迟可能因拆分后包体积变化而不如预期
  - 共享逻辑抽取可能引入循环依赖
- 关联任务：P2-1 代码去重（拆分前需先整理云函数代码结构）
