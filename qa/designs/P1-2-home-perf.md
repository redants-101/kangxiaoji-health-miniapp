## 技术方案：P1-2 首页加载性能优化（脏标记+按需刷新）

### 实现思路

引入轻量级脏标记系统，写操作后标记受影响页面为脏，`onShow` 仅在页面为脏时重新加载；优化首页数据构建逻辑，减少不必要的全量遍历和排序；将缓存 TTL 从12秒提升到60秒，写入后精确清除相关缓存。

### 架构设计

```
┌──────────────────────────────────────────────────────┐
│                    脏标记管理器                         │
│  dirtyFlags: { home: false, trend: false, ... }       │
│                                                        │
│  写操作 ──▶ markDirty(['home', 'trend'])              │
│  onShow  ──▶ isDirty('home') ? loadData() : skip     │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                    缓存优化                            │
│  TTL: 12s → 60s                                       │
│  失效: 前缀匹配 → 精确键匹配                           │
│  写入后: 主动清除相关缓存                               │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│                    数据构建优化                         │
│  buildMetricsFromRecords:                              │
│    全量排序 → find(今日最新)                            │
│  buildWeeklyOverviewFromRecords:                       │
│    全量遍历 → 日期范围过滤 + 计数                       │
└──────────────────────────────────────────────────────┘
```

### 数据流程

#### 脏标记流程

```
1. 初始化：所有页面标记为干净（dirty = false）

2. 写操作触发标记：
   - saveBloodPressureRecord → markDirty(['home', 'trend', 'recordList'])
   - saveBloodGlucoseRecord → markDirty(['home', 'trend', 'recordList'])
   - deleteRecord → markDirty(['home', 'trend', 'recordList'])
   - confirmMedication → markDirty(['home', 'trend'])
   - revokeMedicationConfirmation → markDirty(['home'])
   - saveProfile → markDirty(['home', 'me'])
   - createFamilyInvite → markDirty(['family', 'home'])
   - joinFamilyByInvite → markDirty(['family', 'home'])
   - updateFamilyAuth → markDirty(['family', 'home'])
   - revokeFamilyMember → markDirty(['family', 'home'])
   - saveReminderSettings → markDirty(['home', 'reminder'])

3. 页面 onShow 检查：
   - isDirty('home') ? loadData() : skip
   - loadData 后自动 markClean('home')

4. 页面 onLoad 始终加载数据（首次进入）
```

#### 缓存精确失效流程

```
当前（前缀匹配）：
  records 变更 → 清除所有 'record' 前缀缓存
  → 误清除 recordBp、recordBg、recordDetail、recordList

优化后（精确键匹配）：
  records 变更 → 清除以下精确缓存键：
    - 'home'（首页依赖记录数据）
    - 'recordList'（记录列表依赖记录数据）
    - 'trend'（趋势页依赖记录数据）
  → 不影响 recordBp、recordBg、recordDetail 的缓存
```

### 接口定义

#### 脏标记管理器

```javascript
// services/core.js 新增

const dirtyFlags = {}

const DIRTY_MAP = {
  [STORAGE_KEYS.records]: ['home', 'trend', 'recordList'],
  [STORAGE_KEYS.medicationPlans]: ['home', 'trend', 'medList'],
  [STORAGE_KEYS.medicationConfirmations]: ['home', 'medList'],
  [STORAGE_KEYS.profile]: ['home', 'me'],
  [STORAGE_KEYS.familyAuth]: ['family', 'home'],
  [STORAGE_KEYS.reminderSettings]: ['home', 'reminder'],
  [STORAGE_KEYS.privacySettings]: ['privacy']
}

function markDirty(pages) {
  if (!Array.isArray(pages)) return
  pages.forEach(page => { dirtyFlags[page] = true })
}

function markDirtyByStorageKey(storageKey) {
  const pages = DIRTY_MAP[storageKey]
  if (Array.isArray(pages)) markDirty(pages)
}

function isDirty(page) {
  return !!dirtyFlags[page]
}

function markClean(page) {
  delete dirtyFlags[page]
}
```

#### 修改 writeStorageAndInvalidate

```javascript
function writeStorageAndInvalidate(key, value, relatedKeys = []) {
  const next = writeStorage(key, value)
  // 精确缓存清除（不再使用前缀匹配）
  relatedKeys.forEach(rk => {
    delete cloudReadCache[rk]
    delete inFlightCloudReads[rk]
  })
  // 触发脏标记
  markDirtyByStorageKey(key)
  return next
}
```

#### 修改 getRelatedCacheKeys

```javascript
function getRelatedCacheKeys(storageKey) {
  // 返回精确的缓存键（不再使用前缀）
  const map = {
    [STORAGE_KEYS.profile]: ['profile', 'home', 'me'],
    [STORAGE_KEYS.records]: ['home', 'recordList', 'trend'],
    [STORAGE_KEYS.medicationPlans]: ['medList', 'home', 'reminder'],
    [STORAGE_KEYS.medicationConfirmations]: ['medList', 'home'],
    [STORAGE_KEYS.familyAuth]: ['family', 'homeFamily'],
    [STORAGE_KEYS.reminderSettings]: ['reminder', 'home'],
    [STORAGE_KEYS.privacySettings]: ['privacy', 'profile']
  }
  return map[storageKey] || []
}
```

#### 首页 onShow 优化

```javascript
// pages/home/index.js 修改

onShow() {
  autoPreCheck(this)
  if (this.data._loaded) {
    // 仅在数据脏时重新加载
    const { isDirty, markClean } = require('../../services/core')
    if (isDirty('home')) {
      markClean('home')
      this.loadData()
    }
  }
}
```

#### buildMetricsFromRecords 优化

```javascript
// utils/api.js 修改

function buildMetricsFromRecords(allRecords) {
  const todayStr = getTodayDateValue()

  // 优化：使用 find 替代 sort，仅找今日最新
  let latestBp = null
  let latestBg = null
  for (let i = allRecords.length - 1; i >= 0; i--) {
    const item = allRecords[i]
    const dateStr = item.createdAt || ''
    const isToday = (/^\d{4}-\d{2}-\d{2}/.test(dateStr) && dateStr.slice(0, 10) === todayStr)
      || parseDisplayDateTime(item.time || item.measuredAt || '').dateValue === todayStr
    if (!isToday) continue
    if (item.type === 'bp' && !latestBp) latestBp = item
    if (item.type === 'bg' && !latestBg) latestBg = item
    if (latestBp && latestBg) break
  }

  const metrics = []
  if (latestBp) {
    metrics.push(buildMetricItem(latestBp, '血压'))
  } else {
    metrics.push({ type: 'bp', label: '血压', hasData: false })
  }
  if (latestBg) {
    metrics.push(buildMetricItem(latestBg, '血糖'))
  } else {
    metrics.push({ type: 'bg', label: '血糖', hasData: false })
  }
  return metrics
}
```

### 与现有系统的兼容性

- **首次加载**：`onLoad` 始终加载数据，不受脏标记影响
- **其他页面返回**：`onShow` 检查脏标记，未变更则跳过加载
- **缓存 TTL 变更**：从12秒提升到60秒，写入后主动清除，不影响数据一致性
- **精确缓存失效**：不再误清除无关缓存，减少不必要的云函数请求

### 回滚方案

1. **脏标记**：`isDirty` 默认返回 `true`，等同于每次都刷新（回退到当前行为）
2. **缓存 TTL**：恢复 `CLOUD_READ_CACHE_TTL_MS = 12000`
3. **精确失效**：恢复前缀匹配逻辑
4. **buildMetricsFromRecords**：恢复 `sortRecordsByTime` + `find` 的原始实现
