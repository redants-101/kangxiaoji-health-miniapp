## 技术方案：P0-3 注销冷静期 + 数据删除合规

### 实现思路

注销操作不立即删除数据，而是标记 `pendingDeletionAt = 当前时间 + 7天`；冷静期内用户可撤销；到期后用户打开小程序时检查并执行清理。删除数据增加按日期范围选项。导出增加 CSV 和纯文本格式。

### 架构设计

```
┌────────────────────────────────────────────────────────┐
│                    注销状态机                           │
│                                                        │
│  正常 ──注销请求──▶ 待注销（冷静期7天）                   │
│                        │                               │
│                   ┌────┴────┐                          │
│                   ▼         ▼                          │
│               撤销注销    到期执行                        │
│                   │         │                          │
│                   ▼         ▼                          │
│                 正常     已注销                          │
│                           │                            │
│                           ▼                            │
│                     数据已清理                           │
└────────────────────────────────────────────────────────┘
```

### 数据流程

#### 注销流程

```
1. 用户点击"注销账号"
2. 弹窗确认（showModal('logout')）
3. 写入 pendingDeletionAt 到本地和云端：
   - 本地：writeStorage(STORAGE_KEYS.accountState, { pendingDeletionAt, requestedAt })
   - 云端：requestCloud('requestAccountDeletion', { requestedAt })
4. 页面展示"账号将于X天后注销"提示和"撤销注销"按钮
5. 冷静期内用户可点击"撤销注销"：
   - 清除 pendingDeletionAt
   - 云端标记 cancelled
6. 每次打开小程序（launch 页），检查：
   - 本地是否有 pendingDeletionAt
   - 是否已过期（Date.now() > pendingDeletionAt）
   - 过期则执行 clearUserAccount
```

#### 按日期范围删除

```
1. 删除数据页增加"按日期范围"选项
2. 用户选择起止日期
3. 过滤 records：保留 createdAt 不在范围内的记录
4. 写入过滤后的记录
5. 清除相关缓存
```

#### CSV 导出

```
1. 获取本地数据快照（getLocalDataSnapshot）
2. 展平 records 数组为表格行：
   - 每条记录一行
   - 列：类型、数值、单位、时间、场景、状态、创建时间
3. 添加 BOM 头（\uFEFF）确保中文编码正确
4. 生成 CSV 字符串
5. 返回 { exportText, fileName }
```

### 接口定义

#### 账号状态存储

```javascript
// services/core.js STORAGE_KEYS 新增
const STORAGE_KEYS = {
  // ... 现有键
  accountState: 'account_state_v1'
}
```

#### 注销请求

```javascript
// services/data-rights.js 新增
function requestAccountDeletion(payload = {}) {
  const pendingDeletionAt = Date.now() + 7 * 24 * 60 * 60 * 1000
  writeStorage(STORAGE_KEYS.accountState, {
    pendingDeletionAt,
    requestedAt: new Date().toISOString()
  })
  return resolveRemote('requestAccountDeletion', {
    pendingDeletionAt,
    requestedAt: new Date().toISOString()
  }, () => ({ pendingDeletionAt, requestedAt: new Date().toISOString() }), {
    mirrorLocal: true
  })
}

function cancelAccountDeletion() {
  writeStorage(STORAGE_KEYS.accountState, null)
  return resolveRemote('cancelAccountDeletion', {}, () => ({ cancelled: true }), {
    mirrorLocal: true
  })
}

function checkAndExecuteDeletion() {
  const state = readStorage(STORAGE_KEYS.accountState, null)
  if (!state || !state.pendingDeletionAt) return null
  if (Date.now() < state.pendingDeletionAt) return state
  // 已过期，执行清理
  clearUserAccountLocal()
  writeStorage(STORAGE_KEYS.accountState, null)
  return { deleted: true }
}
```

#### CSV 导出

```javascript
function toExportCSV(exportData) {
  const BOM = '\uFEFF'
  const headers = ['类型', '数值', '单位', '时间', '场景', '状态', '创建时间']
  const rows = (exportData.data.records || []).map(r => [
    r.type === 'bp' ? '血压' : '血糖',
    r.value,
    r.unit,
    r.time,
    r.tag || '',
    r.status,
    extractCreatedAtDate(r)
  ])
  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  return BOM + csv
}
```

#### 按日期范围删除

```javascript
function deleteUserDataByDateRange(startDate, endDate) {
  const records = readStorage(STORAGE_KEYS.records, [])
  const filtered = records.filter(r => {
    const date = extractCreatedAtDate(r)
    return date < startDate || date > endDate
  })
  writeStorageAndInvalidate(STORAGE_KEYS.records, filtered, getRelatedCacheKeys(STORAGE_KEYS.records))
  const deletedCount = records.length - filtered.length
  return { deleted: true, scope: `dateRange:${startDate}:${endDate}`, count: deletedCount }
}
```

### 与现有系统的兼容性

- **无 pendingDeletionAt 的用户**：`checkAndExecuteDeletion` 返回 null，不影响现有行为
- **现有 clearUserAccount**：保留为内部方法，注销流程改为先 request 再 check
- **CSV 导出**：新增格式，不影响现有 JSON 导出
- **按日期范围删除**：新增 scope 类型，现有 health/medication scope 不受影响

### 回滚方案

1. 通过 `featureFlags.coolDownPeriod` 开关关闭冷静期，注销直接执行
2. CSV 导出通过导出页格式选择控制，默认仍为 JSON
