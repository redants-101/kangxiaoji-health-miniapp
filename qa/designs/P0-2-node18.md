## 技术方案：P0-2 云函数运行时升级 Node.js 18

### 实现思路

将 `cloudbaserc.json` 中云函数运行时从 `Nodejs16.13` 升级到 `Nodejs18.x`，验证兼容性后部署。

### 架构设计

```
升级前：
  cloudbaserc.json → runtime: "Nodejs16.13"
  ↓
升级后：
  cloudbaserc.json → runtime: "Nodejs18.x"
```

### 数据流程

```
1. 获取云函数代码（从云开发控制台下载或 git 仓库）
2. 本地 Node.js 18 环境运行回归测试
3. 检查以下兼容性问题：
   a. `new Buffer()` → 替换为 `Buffer.alloc()` / `Buffer.from()`
   b. `util._extend` → 替换为 `Object.assign()` 或展开运算符
   c. `path.exists` → 替换为 `fs.existsSync()`
   d. `domain` 模块 → 已移除，需替换
4. 修改 cloudbaserc.json
5. 部署并验证
```

### 接口定义

```javascript
// cloudbaserc.json 修改
{
  "functions": [
    {
      "name": "healthApi",
      "runtime": "Nodejs18.x",  // 从 "Nodejs16.13" 改为 "Nodejs18.x"
      "timeout": 60
    }
  ]
}
```

### 兼容性检查清单

| 检查项 | Node.js 16 | Node.js 18 | 影响 |
|--------|-----------|-----------|------|
| `Buffer` 构造函数 | 已弃用但仍可用 | 已移除 | 需替换 |
| `util._extend` | 可用 | 已移除 | 需替换 |
| `process.binding` | 可用 | 已移除 | 需替换 |
| `require('domain')` | 可用 | 已移除 | 需替换 |
| `fs.promises` | 实验性 | 稳定 | 可用 |
| `fetch` API | 不可用 | 内置 | 可用 |
| `structuredClone` | 不可用 | 内置 | 可用 |

### 回滚方案

将 `cloudbaserc.json` 的 `runtime` 改回 `"Nodejs16.13"` 并重新部署。注意：Node.js 16 已 EOL，回滚仅为应急方案，应尽快修复兼容性问题后重新升级。
