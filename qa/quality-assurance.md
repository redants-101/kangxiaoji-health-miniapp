# 康小记质量保障流程

本文件定义从需求分析到上线发布的全流程质量控制规范，确保 P0–P3 级别任务高质量交付且不引入新问题。

---

## 一、需求分析阶段

### 1.1 任务优先级与排期

| 级别 | 任务 | 排期窗口 | 阻塞条件 |
|------|------|----------|----------|
| P0-1 | 云函数身份验证 + 数据加密 | 第1周 | 无 |
| P0-2 | 云函数运行时升级 Node.js 18 | 第1周 | 需确认云函数代码兼容性 |
| P0-3 | 注销冷静期 + 数据删除合规 | 第2周 | 依赖 P0-1 身份验证 |
| P1-1 | 首页空状态引导 + 快捷记录入口 | 第2周 | 无 |
| P1-2 | 首页加载性能优化（脏标记+按需刷新） | 第3周 | 无 |
| P1-3 | 缓存策略优化（TTL+精确失效） | 第3周 | 无 |
| P1-4 | 周报动态生成 | 第4周 | 依赖 P1-3 缓存优化 |
| P2-1 | 代码去重（统一默认数据+拆分 medication） | 第4周 | 无 |
| P2-2 | 适老化深度优化 | 第5周 | 无 |
| P2-3 | 统一错误处理体系 | 第5周 | 无 |
| P2-4 | 家庭权限粒度细化 | 第6周 | 依赖 P0-1 身份验证 |
| P3-1 | 云函数拆分（读写分离） | 第7周 | 依赖 P2-1 代码去重 |
| P3-2 | 数据导出多格式支持 | 第7周 | 无 |
| P3-3 | 自动化测试体系建设 | 持续 | 优先覆盖 P0/P1 变更 |
| P3-4 | 增值服务路径规划 | 第8周 | 依赖 P1-4 周报动态生成 |

### 1.2 任务拆解模板

每个任务启动前需填写以下清单，存入 `qa/tasks/{P级}-{序号}-{简称}.md`：

```
## 任务：{标题}
- 级别：P0/P1/P2/P3
- 影响范围：{列出受影响的页面、服务、组件}
- 功能点：
  1. {具体功能描述}
  2. ...
- 技术难点：
  1. {难点及应对策略}
  2. ...
- 验收标准：
  1. {可量化、可验证的标准}
  2. ...
- 回归风险：
  - {可能受影响的现有功能}
- 关联任务：{前置/后置依赖}
```

### 1.3 验收标准示例

**P0-1 云函数身份验证**：
- [ ] 所有云函数写操作通过 `getWXContext()` 获取 openid 并校验
- [ ] 未授权请求返回 403 错误码和友好提示
- [ ] 本地存储敏感数据（records、familyAuth）写入前做混淆处理
- [ ] 现有功能（记录保存、用药确认、家庭邀请）不受影响

**P1-2 首页加载性能优化**：
- [ ] 首页二次加载时间 < 300ms（当前约 800ms）
- [ ] 数据未变更时不触发云函数请求
- [ ] `onShow` 刷新逻辑正确响应其他页面的数据变更

---

## 二、方案设计阶段

### 2.1 技术方案模板

每个 P0/P1 任务需编写技术方案，存入 `qa/designs/{P级}-{序号}-{简称}.md`：

```
## 技术方案：{标题}

### 实现思路
{整体方案描述，200字以内}

### 架构设计
{模块关系图或文字描述}

### 数据流程
{请求→处理→响应的完整流程}

### 接口定义
| 接口 | 方法 | 入参 | 出参 | 说明 |
|------|------|------|------|------|

### 与现有系统的兼容性
- {需要保持兼容的现有行为}
- {可能破坏的兼容点及应对}

### 回滚方案
{出问题时如何快速回滚}
```

### 2.2 方案评审检查单

- [ ] 方案是否与现有数据流兼容（local → cloud → merge 链路）
- [ ] 是否影响 `resolveRemote` 的 `mirrorLocal` 行为
- [ ] 新增的存储键是否已加入 `STORAGE_KEYS` 和 `getRelatedCacheKeys`
- [ ] 新增路由是否已加入 `routes.js` 和 `app.json`
- [ ] 适老化适配是否已考虑（`ui-scale-large` / `ui-scale-elder`）
- [ ] 安全性：是否有未经验证的用户输入直接写入存储或云函数

---

## 三、开发实施阶段

### 3.1 编码规范

#### 命名规范
- 页面文件：`pages/{module}/{page-name}/index.js`
- 服务模块：`services/{module}.js`
- 工具模块：`utils/{module}.js`
- 组件：`components/{component-name}/index.js`
- 存储键：`{业务}_{版本}` 如 `health_records_v1`
- 路由键：`services/routes.js` 中统一管理

#### 数据流规范
- 页面数据获取：通过 `loadPageData(this, loader)` 统一加载
- 页面跳转：通过 `goRoute(routeKey)` 统一跳转
- 服务层调用：页面仅调用 `utils/api.js` 门面方法，不直接依赖 `services/*`
- 本地写入：通过 `writeStorageAndInvalidate` 确保缓存同步失效

#### 错误处理规范
- 服务层：抛出 Error，由 `loadPageData` 统一捕获
- 页面层：`catch` 块使用 `wx.showToast` 展示友好提示，不暴露内部错误
- 云函数错误：脱敏后展示"网络不稳定，请稍后重试"

#### 注释规范
- 每个模块文件顶部：模块职责说明
- 每个导出函数：`/** @returns {Promise<Object>} 描述 */` 格式
- 复杂业务逻辑：行内注释说明决策依据

### 3.2 代码复用策略

| 复用场景 | 策略 | 示例 |
|----------|------|------|
| 默认数据 | 统一使用 `page-data.js` 的 `DEFAULT_PAGE_DATA`，删除 `core.js` 中的 `LIGHTWEIGHT_MOCK` | P2-1 |
| 页面加载 | 统一使用 `page-factory.js` 的 `loadPageData` | 已实现 |
| 路由跳转 | 统一使用 `page-factory.js` 的 `goRoute` | 已实现 |
| 数据合并 | 统一使用 `page-data.js` 的 `deepMerge` + `withMockPageData` | 已实现 |
| 弹窗确认 | 统一使用 `page-factory.js` 的 `showModal` | 已实现 |

### 3.3 代码自查检查单（每次提交前）

- [ ] 无 `console.log` 调试代码残留
- [ ] 无硬编码的云环境 ID 或密钥
- [ ] 新增存储键已加入 `STORAGE_KEYS` 和 `getRelatedCacheKeys`
- [ ] 新增路由已加入 `routes.js`
- [ ] 新增页面已加入 `app.json`
- [ ] 适老化样式已补充（如涉及 UI 变更）
- [ ] `setData` 调用已做 try-catch 保护（页面可能已销毁）

### 3.4 同伴评审流程

1. 开发者提交 PR，标题格式：`[P0-1] 云函数身份验证`
2. 评审者按以下维度检查：
   - 功能正确性：是否符合验收标准
   - 兼容性：是否影响现有功能
   - 安全性：是否引入新的安全风险
   - 性能：是否影响页面加载速度
   - 代码质量：是否符合编码规范
3. 评审通过后合并，未通过则打回修改

---

## 四、测试验证阶段

### 4.1 测试分层策略

| 层级 | 范围 | 工具 | 覆盖目标 |
|------|------|------|----------|
| 单元测试 | services/*、utils/* | Jest + mock | 核心业务逻辑 ≥ 80% |
| 组件测试 | components/* | miniprogram-simulate | 事件触发和数据绑定 |
| 集成测试 | 页面 + 服务 + 云函数 | miniprogram-automator | 关键用户流程 |
| 回归测试 | 云函数接口 | scripts/health-api-regression.js | 已有接口不退化 |

### 4.2 单元测试规范

测试文件位于 `tests/unit/{module}.test.js`，使用 Jest 框架。

#### 必须覆盖的模块（P0 优先级）

| 模块 | 关键测试点 | 关联任务 |
|------|-----------|----------|
| `services/core.js` | `resolveRemote` 的 mirrorLocal 行为、缓存失效逻辑、重试机制 | P1-3 |
| `services/records.js` | 血压评估逻辑、记录去重、本地-云端合并 | P0-1 |
| `services/medication.js` | 确认合并逻辑、用药计划状态机、首页状态合并 | P2-1 |
| `services/family.js` | 授权状态机、邀请码生成、权限校验 | P0-1, P2-4 |
| `services/data-rights.js` | 数据导出、删除范围、注销流程 | P0-3 |
| `utils/pre-check.js` | 隐私检查、资料检查、页面保护逻辑 | P0-1 |
| `utils/chart-adapter.js` | 图表数据构建、边界值处理 | P1-4 |

#### 单元测试模板

```javascript
const { buildBloodPressureRecord } = require('../../services/records')

describe('buildBloodPressureRecord', () => {
  it('正常血压返回正常状态', () => {
    const record = buildBloodPressureRecord({
      systolic: 118, diastolic: 76, pulse: 72,
      tag: '晨起', measuredAt: '07:30', level: '', tip: '血压正常'
    })
    expect(record.status).toBe('正常')
    expect(record.type).toBe('bp')
  })

  it('高血压返回建议复测', () => {
    const record = buildBloodPressureRecord({
      systolic: 150, diastolic: 95, pulse: 80,
      tag: '晨起', measuredAt: '07:30', level: 'warn', tip: '血压偏高'
    })
    expect(record.status).toBe('建议复测')
    expect(record.statusType).toBe('warn')
  })
})
```

### 4.3 集成测试用例

关键用户流程必须覆盖：

| 流程 | 步骤 | 预期结果 |
|------|------|----------|
| 首次使用 | 启动 → 隐私确认 → 资料填写 → 进入首页 | 首页展示默认待办和快捷入口 |
| 血压记录 | 首页 → 记血压 → 填写 → 保存 → 返回首页 | 首页最新记录更新，周概览更新 |
| 用药确认 | 首页待办 → 确认用药 → 返回首页 | 待办状态更新，确认记录保存 |
| 家庭邀请 | 家庭页 → 邀请 → 生成邀请码 → 分享 | 邀请码有效，家庭成员列表更新 |
| 数据导出 | 我的 → 数据管理 → 导出 | 生成包含所有本地数据的 JSON 文件 |
| 注销账号 | 我的 → 注销 → 确认 → 冷静期 → 执行 | 7天后数据清理，期间可撤销 |

### 4.4 P0/P1 压力测试与边界测试

| 任务 | 压力测试 | 边界测试 |
|------|----------|----------|
| P0-1 身份验证 | 100次/秒并发请求 | 无 openid、openid 为空、伪造 openid |
| P1-2 首页性能 | 1000条记录下首页加载时间 | 0条记录、1条记录、10000条记录 |
| P1-3 缓存优化 | 缓存命中率统计 | TTL 边界（11.9s vs 12.1s）、并发读写 |
| P0-3 注销冷静期 | 并发注销和撤销 | 冷静期最后一秒撤销、过期后撤销 |

---

## 五、质量监控阶段

### 5.1 静态代码分析

项目使用 ESLint 进行代码质量检测：

```bash
# 安装依赖
npm install --save-dev eslint @wechat-miniprogram/eslint-plugin

# 运行检查
npx eslint services/ utils/ pages/ components/ --ext .js
```

#### ESLint 配置要点（`.eslintrc.js`）

```javascript
module.exports = {
  env: { es6: true, node: true },
  parserOptions: { ecmaVersion: 2020 },
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-throw-literal': 'error',
    'eqeqeq': ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-shadow': 'error',
    'no-dupe-keys': 'error'
  }
}
```

### 5.2 变更追踪规范

#### Git 分支策略

```
main          ← 稳定发布分支
├── dev       ← 开发集成分支
│   ├── P0-1-cloud-auth     ← P0-1 任务分支
│   ├── P0-2-node18         ← P0-2 任务分支
│   └── P1-1-home-guide     ← P1-1 任务分支
└── hotfix    ← 紧急修复分支
```

#### 提交信息格式

```
[P0-1] feat: 云函数写操作增加 openid 校验
[P1-2] perf: 首页增加脏标记，避免 onShow 重复加载
[P2-1] refactor: 删除 LIGHTWEIGHT_MOCK，统一使用 DEFAULT_PAGE_DATA
[P0-3] fix: 注销操作增加7天冷静期
```

### 5.3 问题跟踪机制

使用 `qa/issues/` 目录记录缺陷，文件名格式 `ISSUE-{序号}.md`：

```markdown
## ISSUE-001：{标题}
- 发现时间：{日期}
- 关联任务：P0-1
- 严重程度：P0/P1/P2/P3
- 复现步骤：
  1. ...
  2. ...
- 预期行为：{描述}
- 实际行为：{描述}
- 修复方案：{描述}
- 修复验证：{验证结果}
- 状态：待修复 / 已修复 / 已验证
```

### 5.4 质量门禁

每次合并到 `dev` 分支前，必须通过以下检查：

- [ ] ESLint 检查无新增 error
- [ ] 相关单元测试全部通过
- [ ] 云函数回归测试通过（`node scripts/health-api-regression.js`）
- [ ] 代码评审已通过
- [ ] 验收标准已逐项确认

---

## 六、发布上线阶段

### 6.1 灰度发布策略

| 级别 | 灰度比例 | 观察时间 | 回滚条件 |
|------|----------|----------|----------|
| P0 | 5% → 20% → 50% → 100% | 每级24小时 | 错误率 > 1% 或数据不一致 |
| P1 | 10% → 50% → 100% | 每级12小时 | 错误率 > 2% 或性能退化 > 20% |
| P2 | 20% → 100% | 每级6小时 | 错误率 > 5% |
| P3 | 50% → 100% | 每级4小时 | 错误率 > 10% |

### 6.2 监控指标

| 指标 | 采集方式 | 告警阈值 |
|------|----------|----------|
| 云函数调用成功率 | 云开发控制台 | < 99% |
| 云函数平均响应时间 | 云开发控制台 | > 2s |
| 页面加载失败率 | `loadPageData` 的 `loadError` 统计 | > 1% |
| 本地存储写入失败率 | `writeStorage` 异常捕获 | > 0.1% |
| 用户反馈数量 | 反馈模块统计 | 单日 > 10条 |

### 6.3 快速回滚机制

1. **代码回滚**：`git revert` 合并提交，重新上传小程序代码
2. **数据回滚**：
   - 本地存储：`clearStorage` + 重新加载
   - 云端数据：通过云函数执行数据修复脚本
3. **功能开关**：在 `api-config.js` 中增加功能开关：

```javascript
const featureFlags = {
  cloudAuth: true,      // P0-1: 云函数身份验证
  coolDownPeriod: true,  // P0-3: 注销冷静期
  dirtyFlag: true,       // P1-2: 首页脏标记
  dynamicReport: true    // P1-4: 动态周报
}

module.exports = { ...apiConfig, featureFlags }
```

功能开关在服务层检查：

```javascript
function saveBloodPressureRecord(payload) {
  if (featureFlags.cloudAuth) {
    // 新逻辑：带身份验证
  } else {
    // 旧逻辑：直接写入
  }
}
```

---

## 七、文档完善阶段

### 7.1 文档更新检查单

每个任务完成后，检查以下文档是否需要更新：

| 文档 | 位置 | 更新条件 |
|------|------|----------|
| API 门面文档 | `utils/api.js` 顶部注释 | 新增/修改导出方法 |
| 路由表 | `utils/routes.js` 顶部注释 | 新增页面路由 |
| 存储键文档 | `services/core.js` STORAGE_KEYS 注释 | 新增存储键 |
| 组件文档 | `components/*/index.js` 顶部注释 | 新增/修改组件属性 |
| 质量保障文档 | `qa/quality-assurance.md` | 流程变更 |
| 任务文档 | `qa/tasks/` | 新增任务或状态变更 |

### 7.2 API 文档格式

```javascript
/**
 * 保存血压记录。
 * @param {Object} payload - 血压记录数据
 * @param {number} payload.systolic - 收缩压（50-260 mmHg）
 * @param {number} payload.diastolic - 舒张压（30-160 mmHg）
 * @param {number|null} payload.pulse - 心率（可选）
 * @param {string} payload.tag - 测量场景
 * @param {string} payload.measuredAt - 测量时间
 * @param {string} [payload.note] - 备注
 * @returns {Promise<Object>} 保存后的记录对象
 * @throws {Error} 当云函数调用失败且无可用缓存时
 */
```

### 7.3 变更日志

每次发布后更新 `qa/CHANGELOG.md`：

```markdown
## [版本号] - 日期

### 新增
- P0-1: 云函数写操作增加 openid 身份验证
- P1-1: 首页空状态引导和快捷记录入口

### 修复
- P0-3: 注销操作增加7天冷静期

### 优化
- P1-2: 首页加载性能优化，二次加载时间降低60%
- P1-3: 缓存 TTL 从12秒提升到60秒

### 破坏性变更
- 无
```

---

## 附录：任务执行检查清单

每个任务从启动到完成，按以下清单逐项确认：

### 启动前
- [ ] 任务文档已创建（`qa/tasks/`）
- [ ] 验收标准已明确
- [ ] 技术方案已评审（P0/P1）
- [ ] 分支已创建

### 开发中
- [ ] 编码规范已遵循
- [ ] 代码自查已完成
- [ ] 单元测试已编写
- [ ] 功能开关已添加（P0/P1）

### 提交前
- [ ] ESLint 检查通过
- [ ] 单元测试通过
- [ ] 云函数回归测试通过
- [ ] 代码评审已通过

### 发布前
- [ ] 验收标准逐项确认
- [ ] 灰度发布计划已制定（P0/P1）
- [ ] 回滚方案已验证
- [ ] 文档已更新

### 发布后
- [ ] 监控指标正常
- [ ] 灰度逐步放量
- [ ] 变更日志已更新
- [ ] 任务状态已关闭
