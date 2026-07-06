## 技术方案：P2-1 代码去重（统一默认数据+拆分 medication）

### 实现思路

删除 `core.js` 的 `LIGHTWEIGHT_MOCK`，所有默认值统一从 `page-data.js` 的 `DEFAULT_PAGE_DATA` 获取；删除 `profile.js` 中硬编码的 `DEFAULT_SETTING_GROUPS`；将 `medication.js`（929行）拆分为三个子模块，`medication.js` 保留为门面重新导出。

### 架构设计

```
拆分前：
  medication.js (929行) → 所有用药相关逻辑

拆分后：
  medication.js (门面, <50行) → 重新导出三个子模块
  ├── medication-plan.js (<350行) → 用药计划 CRUD
  ├── medication-confirm.js (<350行) → 用药确认记录
  └── medication-merge.js (<350行) → 首页/家属页/提醒中心状态合并
```

### 数据流程

#### 默认数据统一

```
1. 删除 core.js 中的 LIGHTWEIGHT_MOCK
2. 修改 core.js 的 resolveMockData：
   function resolveMockData(key, payload = {}) {
     if (apiConfig.dataSource === 'cloud') return requestCloudByKey(key, payload)
     if (apiConfig.dataSource === 'http') return requestHttp(`get/${key}`, payload)
     // local 模式：从 DEFAULT_PAGE_DATA 获取默认数据
     const { DEFAULT_PAGE_DATA } = require('./page-data')
     return Promise.resolve(clone(DEFAULT_PAGE_DATA[key] || {}))
   }
3. 删除 profile.js 中的 DEFAULT_SETTING_GROUPS 硬编码
4. 引用 DEFAULT_PAGE_DATA.me.settingGroups
```

#### medication 拆分

```
medication-plan.js 导出：
  - getStoredMedicationPlans
  - upsertMedicationPlan
  - saveMedicationPlanLocal
  - deleteMedicationPlanLocal
  - toggleMedicationPlanStatusLocal
  - saveMedicationPlan
  - deleteMedicationPlan
  - toggleMedicationPlanStatus
  - mapMedicationPlanToListItem
  - getMedicationEditData

medication-confirm.js 导出：
  - getStoredMedicationConfirmations
  - getLatestMedicationConfirmation
  - appendMedicationConfirmation
  - confirmMedicationLocal
  - revokeMedicationConfirmationLocal
  - confirmMedication
  - revokeMedicationConfirmation
  - mergeConfirmationsByLogId

medication-merge.js 导出：
  - mergeMedicationPlans
  - mergeHomeMedicationStatus
  - mergeHomeFamilyMedicationStatus
  - mergeMedConfirmMedication
  - mergeReminderMedicationStatus
  - parseMedTaskId
  - findNextPendingTime

medication.js（门面）：
  module.exports = {
    ...require('./medication-plan'),
    ...require('./medication-confirm'),
    ...require('./medication-merge')
  }
```

### 接口定义

#### medication-plan.js 内部依赖

```javascript
const { STORAGE_KEYS, createRecordId, readStorage, writeStorage, resolveRemote, resolveMockData } = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')
const { getTodayDateValue, normalizeDateValue } = require('../utils/date-helper')
```

#### medication-confirm.js 内部依赖

```javascript
const { STORAGE_KEYS, createRecordId, readStorage, writeStorage, resolveRemote } = require('./core')
const { getTodayDateValue } = require('../utils/date-helper')
```

#### medication-merge.js 内部依赖

```javascript
const { STORAGE_KEYS, readStorage, resolveMockData } = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')
const { getStoredMedicationPlans } = require('./medication-plan')
const { getStoredMedicationConfirmations, getLatestMedicationConfirmation } = require('./medication-confirm')
const { getTodayDateValue, normalizeDateValue } = require('../utils/date-helper')
```

### 与现有系统的兼容性

- **api.js 调用方式不变**：`medication.js` 门面重新导出所有方法
- **页面 require 路径不变**：`require('../../services/medication')` 仍有效
- **DEFAULT_PAGE_DATA 数据结构不变**：仅删除 `LIGHTWEIGHT_MOCK` 中的重复定义
- **循环依赖处理**：`medication-merge.js` 依赖 `medication-plan.js` 和 `medication-confirm.js`，不存在循环

### 回滚方案

1. 恢复 `LIGHTWEIGHT_MOCK` 定义
2. 恢复 `medication.js` 为单文件
3. `resolveMockData` 恢复从 `LIGHTWEIGHT_MOCK` 读取
