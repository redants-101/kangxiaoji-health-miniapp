## 技术方案：P1-3 缓存策略优化（TTL+精确失效）

### 实现思路

将云端读缓存 TTL 从 12 秒提升到 60 秒；缓存失效从前缀匹配改为精确键映射；新增 `clearCacheByKeys` 方法替代 `clearCacheByPrefix`；`getHomeData` 中的全量清除改为按需清除。

### 架构设计

```
缓存键映射表（存储键 → 缓存键列表）：

STORAGE_KEYS.records      → ['home', 'recordList', 'trend']
STORAGE_KEYS.profile      → ['profile', 'home', 'me']
STORAGE_KEYS.medicationPlans → ['medList', 'home', 'reminder']
STORAGE_KEYS.medicationConfirmations → ['medList', 'home']
STORAGE_KEYS.familyAuth   → ['family', 'homeFamily']
STORAGE_KEYS.reminderSettings → ['reminder', 'home']
STORAGE_KEYS.privacySettings → ['privacy', 'profile']

写入时：
  writeStorageAndInvalidate(key, value, getRelatedCacheKeys(key))
  → 仅清除映射表中指定的缓存键

读取时：
  requestCloudByKey(key, payload)
  → 缓存 TTL = 60s
  → 命中缓存直接返回
  → 未命中则请求云函数
```

### 数据流程

#### 缓存精确失效流程

```
1. 用户保存血压记录
2. saveBloodPressureRecord → resolveRemote → requestCloud
3. requestCloud 成功后调用 clearCloudReadCache()（当前：全量清除）
4. 优化后：仅清除 getRelatedCacheKeys(STORAGE_KEYS.records) 指定的缓存键
5. 清除的缓存键：'home', 'recordList', 'trend'
6. 保留的缓存键：'recordBp', 'recordBg', 'recordDetail', 'medList', 'family' 等
```

#### getHomeData 优化

```
当前：
  getHomeData() {
    clearCloudReadCache()  // 全量清除
    return Promise.all([...])
  }

优化后：
  getHomeData() {
    // 不再全量清除，依赖缓存 TTL 和写入后的精确失效
    return Promise.all([...])
  }
```

### 接口定义

#### 缓存常量修改

```javascript
// services/core.js
const CLOUD_READ_CACHE_TTL_MS = 60000  // 从 12000 改为 60000
```

#### 新增 clearCacheByKeys

```javascript
function clearCacheByKeys(keys) {
  if (!Array.isArray(keys)) return
  keys.forEach(key => {
    delete cloudReadCache[key]
    delete inFlightCloudReads[key]
  })
}
```

#### 修改 writeStorageAndInvalidate

```javascript
function writeStorageAndInvalidate(key, value, relatedKeys = []) {
  const next = writeStorage(key, value)
  // 精确清除（替代前缀匹配）
  clearCacheByKeys(relatedKeys)
  // 触发脏标记
  markDirtyByStorageKey(key)
  return next
}
```

#### 修改 getRelatedCacheKeys

```javascript
function getRelatedCacheKeys(storageKey) {
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

#### 修改 getHomeData

```javascript
// utils/api.js
function getHomeData() {
  // 移除 clearCloudReadCache() 全量清除
  return Promise.all([
    resolveMockData('home'),
    resolveMockData('recordList')
  ]).then(([homeRemote, listRemote]) =>
    normalizeHomeData(homeRemote, listRemote)
  )
    .then(profile.mergeProfileIntoHome)
    .then(medication.mergeHomeMedicationStatus)
}
```

### 与现有系统的兼容性

- **缓存 TTL 延长**：写入后主动清除相关缓存，确保数据一致性
- **精确失效**：不再误清除无关缓存，减少不必要的云函数请求
- **getHomeData 移除全量清除**：依赖写入后的精确失效和 TTL 过期

### 回滚方案

1. 恢复 `CLOUD_READ_CACHE_TTL_MS = 12000`
2. 恢复 `clearCacheByPrefix` 逻辑
3. 恢复 `getHomeData` 中的 `clearCloudReadCache()`
