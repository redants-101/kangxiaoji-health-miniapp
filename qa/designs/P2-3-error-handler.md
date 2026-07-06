## 技术方案：P2-3 统一错误处理体系

### 实现思路

创建 `utils/error-handler.js`，统一错误分类和用户提示文案映射；云函数错误信息脱敏；所有页面 catch 块统一使用 error-handler 处理；关键错误使用 notice 组件持久展示。

### 架构设计

```
错误处理链路：

页面 catch(error)
    │
    ▼
error-handler.handleError(error, context)
    │
    ├── classifyError(error) → 错误分类
    │   ├── network: 网络错误（超时/断网/服务器不可达）
    │   ├── permission: 权限错误（未授权/身份过期）
    │   ├── data: 数据错误（格式异常/字段缺失）
    │   ├── system: 系统错误（云函数异常/存储溢出）
    │   └── unknown: 未知错误
    │
    ├── getUserMessage(category, error) → 用户友好提示
    │   ├── network → "网络不稳定，请稍后重试"
    │   ├── permission → "操作未授权，请重新进入"
    │   ├── data → "数据异常，请刷新重试"
    │   ├── system → "系统繁忙，请稍后重试"
    │   └── unknown → "操作失败，请稍后重试"
    │
    └── displayMessage(message, options) → 展示方式
        ├── toast: 轻提示（3秒消失）
        └── notice: 持久展示（需手动关闭）
```

### 接口定义

#### error-handler.js

```javascript
const ERROR_CATEGORIES = {
  NETWORK: 'network',
  PERMISSION: 'permission',
  DATA: 'data',
  SYSTEM: 'system',
  UNKNOWN: 'unknown'
}

const NETWORK_PATTERNS = ['timeout', 'timed out', 'etimedout', 'econnreset', 'econnaborted', 'socket hang up', 'network', 'request:fail']
const PERMISSION_PATTERNS = ['unauthorized', 'forbidden', '403', 'openid', 'auth']
const DATA_PATTERNS = ['invalid', 'parse', 'json', 'schema', 'required']
const SYSTEM_PATTERNS = ['systemerror', 'internal', 'cloud function', 'errcode']

function classifyError(error) {
  const text = String(error?.errMsg || error?.message || error).toLowerCase()
  if (NETWORK_PATTERNS.some(p => text.includes(p))) return ERROR_CATEGORIES.NETWORK
  if (PERMISSION_PATTERNS.some(p => text.includes(p))) return ERROR_CATEGORIES.PERMISSION
  if (DATA_PATTERNS.some(p => text.includes(p))) return ERROR_CATEGORIES.DATA
  if (SYSTEM_PATTERNS.some(p => text.includes(p))) return ERROR_CATEGORIES.SYSTEM
  return ERROR_CATEGORIES.UNKNOWN
}

const USER_MESSAGES = {
  [ERROR_CATEGORIES.NETWORK]: '网络不稳定，请稍后重试',
  [ERROR_CATEGORIES.PERMISSION]: '操作未授权，请重新进入页面',
  [ERROR_CATEGORIES.DATA]: '数据异常，请刷新重试',
  [ERROR_CATEGORIES.SYSTEM]: '系统繁忙，请稍后重试',
  [ERROR_CATEGORIES.UNKNOWN]: '操作失败，请稍后重试'
}

function getUserMessage(category) {
  return USER_MESSAGES[category] || USER_MESSAGES[ERROR_CATEGORIES.UNKNOWN]
}

function handleError(error, context = {}) {
  const category = classifyError(error)
  const userMessage = context.customMessage || getUserMessage(category)

  // 脱敏日志：记录原始错误但不暴露给用户
  console.warn(`[ErrorHandler] ${category}:`, error?.errMsg || error?.message || error, context)

  // 关键错误持久展示
  const persistent = category === ERROR_CATEGORIES.PERMISSION || category === ERROR_CATEGORIES.SYSTEM

  if (persistent && typeof wx !== 'undefined') {
    wx.showToast({ title: userMessage, icon: 'none', duration: 5000 })
  } else if (typeof wx !== 'undefined') {
    wx.showToast({ title: userMessage, icon: 'none' })
  }

  return { category, userMessage, persistent }
}

module.exports = {
  ERROR_CATEGORIES,
  classifyError,
  getUserMessage,
  handleError
}
```

#### 页面 catch 块统一

```javascript
// 修改前
catch (error) {
  wx.showToast({ title: error.message || '保存失败', icon: 'none' })
}

// 修改后
const { handleError } = require('../../utils/error-handler')
catch (error) {
  handleError(error, { page: 'recordBp', action: 'save' })
}
```

### 与现有系统的兼容性

- **现有错误提示不变**：用户看到的提示文案与现有基本一致，仅脱敏
- **开发者调试**：`console.warn` 保留原始错误信息，不影响调试
- **逐步迁移**：可逐页面替换 catch 块，不需要一次性全部修改

### 回滚方案

删除 `error-handler.js`，恢复各页面 catch 块直接使用 `wx.showToast`。
