## 技术方案：P2-4 家庭权限粒度细化

### 实现思路

扩展家庭关系类型；邀请码增加有效期管理；将 scopes 从 `enabled/disabled` 扩展为 `{read, write, remind}` 三级权限；在数据读取和写入点增加权限校验。

### 架构设计

```
权限模型：

旧模型（两级）：
  scopes: [{ key: 'bloodPressure', title: '血压记录', enabled: true }]

新模型（三级）：
  scopes: [{
    key: 'bloodPressure',
    title: '血压记录',
    read: true,     // 可查看记录
    write: false,    // 可代为记录
    remind: true     // 可接收提醒
  }]

兼容策略：
  读取旧数据时：enabled=true → { read: true, write: false, remind: true }
  写入新数据时：使用三级格式
```

### 数据流程

#### 关系类型扩展

```javascript
const relationMap = {
  daughter: { relation: '女儿', role: '主要照护人' },
  son: { relation: '儿子', role: '紧急联系人' },
  spouse: { relation: '配偶', role: '共同管理' },
  granddaughter: { relation: '孙女', role: '主要照护人' },
  grandson: { relation: '孙子', role: '主要照护人' },
  sibling: { relation: '兄弟姐妹', role: '共同管理' },
  caregiver: { relation: '护工', role: '协助管理' },
  other: { relation: '家属', role: '共同管理' }
}
```

#### 邀请码有效期

```javascript
function createFamilyInviteLocal(payload, remoteResult) {
  // ... 现有逻辑 ...
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000
  const nextState = {
    ...storedAuth,
    inviteCode,
    expiresAt,  // 新增有效期
    // ...
  }
  writeStorage(STORAGE_KEYS.familyAuth, nextState)
  return { ...nextState, inviteCode, sharePath }
}

function joinFamilyByInviteLocal(payload, remoteResult) {
  const storedAuth = getStoredFamilyAuth() || {}
  // 校验有效期
  if (storedAuth.expiresAt && Date.now() > storedAuth.expiresAt) {
    throw new Error('邀请已过期，请重新获取邀请')
  }
  // 无 expiresAt 的旧邀请码视为永不过期
  // ... 现有逻辑 ...
}
```

#### 权限校验

```javascript
function hasScopePermission(scopes, scopeKey, permission) {
  if (!Array.isArray(scopes)) return false
  const scope = scopes.find(s => s.key === scopeKey)
  if (!scope) return false
  // 兼容旧格式：enabled=true 视为 read+remind
  if (scope.enabled !== undefined) {
    if (permission === 'read' || permission === 'remind') return !!scope.enabled
    return false
  }
  return !!scope[permission]
}

function getScopeText(scopes, fallback = '暂未授权') {
  if (!Array.isArray(scopes)) return fallback
  const enabledTitles = scopes
    .filter(s => s.read || s.enabled)
    .map(s => s.title)
  return enabledTitles.length ? enabledTitles.join('、') : fallback
}
```

### 与现有系统的兼容性

- **旧格式 scopes**：`enabled=true` 自动映射为 `{ read: true, write: false, remind: true }`
- **旧邀请码**：无 `expiresAt` 字段视为永不过期
- **权限校验**：`hasScopePermission` 兼容新旧两种格式
- **getScopeText**：兼容 `enabled` 和 `read` 两种判断方式

### 回滚方案

1. 通过 `featureFlags.familyPermission` 开关关闭三级权限
2. 关闭后 scopes 仍使用 `enabled/disabled` 格式
3. 邀请码有效期通过 `featureFlags.secureInvite` 开关控制
