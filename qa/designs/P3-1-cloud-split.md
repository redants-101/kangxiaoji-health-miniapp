## 技术方案：P3-1 云函数拆分（读写分离）

### 实现思路

将单一云函数 `healthApi` 拆分为 `healthRead`（高频低延迟）和 `healthWrite`（低频可容忍延迟）；前端 `requestCloudByKey` 路由到 `healthRead`，`requestCloud` 路由到 `healthWrite`。

### 架构设计

```
拆分前：
  前端 → healthApi（所有读写操作）

拆分后：
  前端 → healthRead（读操作，高频低延迟）
       → healthWrite（写操作，低频可容忍延迟）

共享层：
  cloudfunctions/shared/
  ├── db.js          → 数据库操作封装
  ├── auth.js        → 身份校验
  ├── validator.js   → 输入校验
  └── constants.js   → 集合名等常量
```

### 数据流程

#### 读操作路由

```
requestCloudByKey(key, payload)
  → wx.cloud.callFunction({ name: 'healthRead', data: { key, payload } })
```

#### 写操作路由

```
requestCloud(action, payload)
  → wx.cloud.callFunction({ name: 'healthWrite', data: { action, payload } })
```

### 接口定义

#### cloudbaserc.json

```json
{
  "functions": [
    {
      "name": "healthRead",
      "runtime": "Nodejs18.x",
      "timeout": 30
    },
    {
      "name": "healthWrite",
      "runtime": "Nodejs18.x",
      "timeout": 60
    }
  ]
}
```

#### api-config.js

```javascript
const apiConfig = {
  dataSource: 'cloud',
  cloudReadFunctionName: 'healthRead',
  cloudWriteFunctionName: 'healthWrite',
  cloudFunctionName: 'healthApi',  // 保留兼容
  httpBaseUrl: ''
}
```

#### core.js 修改

```javascript
function requestCloudByKey(key, payload = {}) {
  // ... 缓存逻辑不变
  const request = callCloudWithRetry({
    name: apiConfig.cloudReadFunctionName,  // 改为 healthRead
    data: { key, payload }
  })
  // ...
}

function requestCloud(action, payload) {
  return callCloudWithRetry({
    name: apiConfig.cloudWriteFunctionName,  // 改为 healthWrite
    data: { action, payload }
  })
  // ...
}
```

### 与现有系统的兼容性

- **前端 API 不变**：`utils/api.js` 接口不变，仅底层路由变更
- **local 模式不受影响**：`dataSource=local` 时直接读本地数据
- **灰度切换**：通过 `apiConfig.cloudReadFunctionName` 和 `cloudWriteFunctionName` 控制

### 回滚方案

1. 将 `cloudReadFunctionName` 和 `cloudWriteFunctionName` 改回 `cloudFunctionName`
2. 重新部署 `healthApi` 云函数
