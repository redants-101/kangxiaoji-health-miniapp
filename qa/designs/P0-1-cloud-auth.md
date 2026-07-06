## 技术方案：P0-1 云函数身份验证 + 数据加密

### 实现思路

在云函数入口统一校验用户身份，所有写操作验证数据归属；本地存储敏感数据写入前做简单 XOR 混淆，读取时自动解混淆并兼容已有明文数据；邀请码改用随机算法并嵌入有效期。

### 架构设计

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  小程序前端   │────▶│  云函数 healthApi  │────▶│  云数据库    │
│  (services/) │     │  ┌────────────┐  │     │             │
│              │     │  │ 身份校验层  │  │     │  _openid   │
│  writeStorage │     │  │ (新增)     │  │     │  字段校验   │
│  ↓ 混淆写入   │     │  └────────────┘  │     │             │
│  readStorage  │     │  ┌────────────┐  │     │             │
│  ↑ 自动解混淆 │     │  │ 业务逻辑层  │  │     │             │
│              │     │  │ (现有)      │  │     │             │
│              │     │  └────────────┘  │     │             │
└─────────────┘     └──────────────────┘     └─────────────┘
```

### 数据流程

#### 云函数身份验证流程

```
1. 小程序调用 wx.cloud.callFunction({ name: 'healthApi', data: { action, payload } })
2. 云函数入口获取 openid: const { OPENID } = cloud.getWXContext()
3. 写操作校验：
   a. 如果 payload 包含 _openid，验证是否等于当前 OPENID
   b. 如果操作涉及已有文档（如更新/删除），查询文档的 _openid 是否等于当前 OPENID
   c. 校验失败返回 { errMsg: 'unauthorized', code: 403 }
4. 读操作：仅查询 _openid === OPENID 的文档（已有逻辑，确认生效）
```

#### 本地数据混淆流程

```
写入：
1. 原始数据 → JSON.stringify → btoa(简单XOR) → wx.setStorageSync

读取：
1. wx.getStorageSync → 尝试 atob(简单XOR) → JSON.parse
2. 如果解混淆失败（旧数据为明文），直接 JSON.parse
3. 返回数据

兼容策略：
- 读取时先尝试解混淆，失败则按明文处理
- 写入时统一使用混淆格式
- 迁移：用户下次写入时自动转为混淆格式
```

#### 邀请码安全流程

```
创建邀请：
1. 生成16位随机码：crypto.getRandomValues(new Uint8Array(12)) → hex string
2. 存储：{ inviteCode, createdAt: Date.now(), expiresAt: Date.now() + 24*60*60*1000 }
3. 返回邀请码和分享路径

加入家庭：
1. 查询邀请码记录
2. 校验：expiresAt > Date.now()
3. 过期则返回 { errMsg: '邀请已过期，请重新获取邀请' }
```

### 接口定义

#### 云函数新增通用校验

```javascript
// cloudfunctions/healthApi/index.js
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, payload, key } = event

  // 写操作白名单
  const WRITE_ACTIONS = [
    'saveBloodPressureRecord',
    'saveBloodGlucoseRecord',
    'deleteRecord',
    'rebuildRecordStats',
    'saveMedicationPlan',
    'deleteMedicationPlan',
    'toggleMedicationPlanStatus',
    'confirmMedication',
    'revokeMedicationConfirmation',
    'createFamilyInvite',
    'joinFamilyByInvite',
    'updateFamilyAuth',
    'revokeFamilyMember',
    'saveProfile',
    'saveReminderSettings',
    'updatePrivacySettings',
    'submitFeedback',
    'exportUserData',
    'deleteUserData',
    'clearUserAccount'
  ]

  if (WRITE_ACTIONS.includes(action)) {
    if (!OPENID) {
      return { errMsg: 'unauthorized', code: 403 }
    }
    // 将 OPENID 注入 payload，业务层使用
    payload._openid = OPENID
  }

  // 路由到业务处理函数...
}
```

#### 本地存储混淆接口

```javascript
// services/core.js 新增

const OBFUSCATE_PREFIX = '__kxj__:'

function obfuscate(value) {
  const json = JSON.stringify(value)
  const encoded = btoa(json.split('').map(c =>
    String.fromCharCode(c.charCodeAt(0) ^ 0x5A)
  ).join(''))
  return OBFUSCATE_PREFIX + encoded
}

function deobfuscate(value) {
  if (typeof value !== 'string' || !value.startsWith(OBFUSCATE_PREFIX)) {
    return null // 非混淆格式，返回 null 表示需要按明文处理
  }
  try {
    const encoded = value.slice(OBFUSCATE_PREFIX.length)
    const decoded = atob(encoded)
    const json = decoded.split('').map(c =>
      String.fromCharCode(c.charCodeAt(0) ^ 0x5A)
    ).join('')
    return JSON.parse(json)
  } catch (e) {
    return null
  }
}

// 需要混淆的存储键
const OBFUSCATED_KEYS = new Set([
  STORAGE_KEYS.records,
  STORAGE_KEYS.familyAuth
])

// 修改 readStorage
function readStorage(key, fallback) {
  if (!hasWxStorage()) return clone(memoryStorage[key] || fallback)
  const raw = wx.getStorageSync(key)
  if (raw === undefined || raw === null || raw === '') return clone(fallback)
  // 尝试解混淆
  if (OBFUSCATED_KEYS.has(key) && typeof raw === 'string' && raw.startsWith(OBFUSCATE_PREFIX)) {
    const deobfuscated = deobfuscate(raw)
    if (deobfuscated !== null) return deobfuscated
  }
  // 兼容旧数据：明文格式
  return clone(raw || fallback)
}

// 修改 writeStorage
function writeStorage(key, value) {
  const next = clone(value)
  if (OBFUSCATED_KEYS.has(key)) {
    const obfuscated = obfuscate(next)
    if (!hasWxStorage()) { memoryStorage[key] = next; return next }
    wx.setStorageSync(key, obfuscated)
    return next
  }
  if (!hasWxStorage()) { memoryStorage[key] = next; return next }
  wx.setStorageSync(key, next)
  return next
}
```

#### 邀请码安全接口

```javascript
// services/family.js 修改

function generateSecureInviteCode() {
  const bytes = new Uint8Array(12)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function createFamilyInviteLocal(payload, remoteResult) {
  // ... 现有逻辑 ...
  const inviteCode = (remoteResult && (remoteResult.inviteCode || remoteResult.inviteId))
    || generateSecureInviteCode()
  // ... 增加有效期 ...
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000
  // ... 存储到 familyAuth ...
}

function joinFamilyByInviteLocal(payload, remoteResult) {
  const storedAuth = getStoredFamilyAuth() || {}
  const inviteCode = (payload && payload.inviteCode) || storedAuth.inviteCode || ''

  // 校验有效期
  if (storedAuth.expiresAt && Date.now() > storedAuth.expiresAt) {
    throw new Error('邀请已过期，请重新获取邀请')
  }
  // ... 现有逻辑 ...
}
```

### 与现有系统的兼容性

- **本地开发模式（dataSource=local）**：身份验证仅在云函数端执行，本地模式不受影响
- **已有明文数据**：`readStorage` 先尝试解混淆，失败则按明文处理，向后兼容
- **已有邀请码**：旧邀请码无 `expiresAt` 字段，`joinFamilyByInviteLocal` 检查时跳过有效期校验
- **`mirrorLocal` 行为**：云函数返回后本地镜像写入，混淆在 `writeStorage` 层自动处理

### 回滚方案

1. **云函数身份验证**：通过 `api-config.js` 的 `featureFlags.cloudAuth` 开关关闭
2. **数据混淆**：`readStorage` 兼容明文格式，关闭混淆后新数据以明文写入，旧混淆数据仍可读取
3. **邀请码安全**：通过 `featureFlags.secureInvite` 开关关闭，回退到 `Date.now()` 生成方式
