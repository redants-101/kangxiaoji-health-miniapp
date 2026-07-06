## 技术方案：P3-3 自动化测试体系建设

### 实现思路

补齐剩余 5 个核心模块的单元测试；创建 wx 全局对象 mock；编写关键用户流程的集成测试脚本；配置 CI 流水线。

### 架构设计

```
tests/
├── unit/                          ← 单元测试（Jest + mock）
│   ├── core.test.js               ✅ 已有
│   ├── records.test.js            ✅ 已有
│   ├── family.test.js             ✅ 已有
│   ├── chart-adapter.test.js      ✅ 已有
│   ├── date-helper.test.js        ✅ 已有
│   ├── page-data.test.js          ✅ 已有
│   ├── medication-plan.test.js    ← 新增
│   ├── medication-confirm.test.js ← 新增
│   ├── medication-merge.test.js   ← 新增
│   ├── data-rights.test.js        ← 新增
│   ├── settings.test.js           ← 新增
│   ├── privacy.test.js            ← 新增
│   └── pre-check.test.js          ← 新增
├── integration/                   ← 集成测试
│   └── user-flows.test.js         ← 新增
├── mocks/                         ← Mock 层
│   └── wx.js                      ← wx 全局对象 mock
└── setup.js                       ← Jest 全局 setup
```

### 接口定义

#### wx 全局对象 mock

```javascript
// tests/mocks/wx.js
const storage = {}

const wx = {
  cloud: {
    init: jest.fn(),
    callFunction: jest.fn().mockResolvedValue({ result: {} })
  },
  getStorageSync: jest.fn((key) => storage[key] || ''),
  setStorageSync: jest.fn((key, value) => { storage[key] = value }),
  removeStorageSync: jest.fn((key) => { delete storage[key] }),
  clearStorageSync: jest.fn(() => { Object.keys(storage).forEach(k => delete storage[k]) }),
  showToast: jest.fn(),
  showModal: jest.fn(),
  navigateTo: jest.fn(),
  redirectTo: jest.fn(),
  switchTab: jest.fn(),
  navigateBack: jest.fn(),
  request: jest.fn(),
  getAppBaseInfo: jest.fn().mockReturnValue({ fontSizeSetting: 17, fontSizeScaleFactor: 1 }),
  getWindowInfo: jest.fn().mockReturnValue({ windowWidth: 375 }),
  onWindowResize: jest.fn(),
  offWindowResize: jest.fn()
}

global.wx = wx
module.exports = wx
```

#### Jest setup

```javascript
// tests/setup.js
require('./mocks/wx')

beforeEach(() => {
  const wx = require('./mocks/wx')
  wx.clearStorageSync()
  jest.clearAllMocks()
})
```

#### 集成测试用例

```javascript
// tests/integration/user-flows.test.js
describe('关键用户流程', () => {
  test('首次使用流程', async () => {
    // 启动 → 隐私确认 → 资料填写 → 进入首页
  })

  test('血压记录流程', async () => {
    // 首页 → 记血压 → 填写 → 保存 → 返回首页
  })

  test('用药确认流程', async () => {
    // 首页待办 → 确认用药 → 返回首页
  })

  test('家庭邀请流程', async () => {
    // 家庭页 → 邀请 → 生成邀请码 → 分享
  })

  test('数据导出流程', async () => {
    // 我的 → 数据管理 → 导出
  })

  test('注销冷静期流程', async () => {
    // 我的 → 注销 → 确认 → 冷静期 → 撤销
  })
})
```

### 与现有系统的兼容性

- **单元测试**：在 Node.js 环境运行，不影响小程序运行时
- **集成测试**：需要微信开发者工具环境，CI 中使用 headless 模式
- **覆盖率门禁**：低于阈值时 CI 阻止合并，但不阻止本地开发

### 回滚方案

1. 删除 `tests/` 目录
2. 移除 `package.json` 中的 jest 配置
3. 移除 CI 配置文件
