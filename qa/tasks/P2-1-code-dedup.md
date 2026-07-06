## 任务：P2-1 代码去重（统一默认数据+拆分 medication）

- 级别：P2
- 影响范围：`services/core.js`、`services/page-data.js`、`services/medication.js`、`services/profile.js`
- 功能点：
  1. 删除 `core.js` 中的 `LIGHTWEIGHT_MOCK`，所有默认值统一使用 `page-data.js` 的 `DEFAULT_PAGE_DATA`
  2. 删除 `profile.js` 中硬编码的 `DEFAULT_SETTING_GROUPS`，引用 `DEFAULT_PAGE_DATA.me.settingGroups`
  3. 将 `medication.js`（929行）拆分为三个模块：
     - `medication-plan.js`：用药计划 CRUD（save/delete/toggle/status）
     - `medication-confirm.js`：用药确认记录（confirm/revoke/merge）
     - `medication-merge.js`：首页/家属页/提醒中心的用药状态合并逻辑
  4. `medication.js` 保留为门面模块，重新导出三个子模块的方法
- 技术难点：
  1. `LIGHTWEIGHT_MOCK` 和 `DEFAULT_PAGE_DATA` 的数据结构不完全一致，需逐字段对齐
  2. `medication.js` 内部方法互相调用，拆分后需处理循环依赖
  3. `utils/api.js` 和多个页面直接引用 `medication.js` 的方法，拆分后需保持 API 不变
- 验收标准：
  1. `core.js` 中不再存在 `LIGHTWEIGHT_MOCK` 常量
  2. `profile.js` 中不再硬编码 `DEFAULT_SETTING_GROUPS`
  3. `medication.js` 行数 < 50 行（仅保留重新导出）
  4. `medication-plan.js`、`medication-confirm.js`、`medication-merge.js` 各 < 350 行
  5. 所有页面功能不受影响（`require('../../utils/api')` 调用方式不变）
  6. 云函数回归测试通过
- 回归风险：
  - 拆分 medication 可能引入循环依赖或遗漏导出
  - 默认数据统一后，某些页面的初始状态可能变化
- 关联任务：P1-3 缓存策略优化（拆分后缓存映射需更新）
