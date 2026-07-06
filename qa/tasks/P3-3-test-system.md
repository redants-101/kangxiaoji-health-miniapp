## 任务：P3-3 自动化测试体系建设

- 级别：P3
- 影响范围：`tests/`、`scripts/`、`.github/workflows/`（新增）
- 功能点：
  1. 补齐剩余 5 个核心模块的单元测试（medication/data-rights/settings/privacy/pre-check）
  2. 编写关键用户流程的集成测试脚本（基于 miniprogram-automator）
  3. 配置 CI/CD 流水线（GitHub Actions 或微信开发者工具 CI）
  4. 建立测试覆盖率门禁（核心模块 ≥ 80%）
- 技术难点：
  1. `wx` 全局对象需 mock 才能在 Node.js 环境运行单元测试
  2. `medication.js` 逻辑复杂（929行），测试用例设计需覆盖多种状态组合
  3. 集成测试需要微信开发者工具环境，CI 环境配置复杂
  4. 小程序自动化测试工具（miniprogram-automator）稳定性有限
- 验收标准：
  1. 核心模块单元测试覆盖率 ≥ 80%
  2. `medication.js` 拆分后三个子模块各有独立测试
  3. 集成测试覆盖 6 条关键用户流程
  4. CI 流水线在 PR 时自动运行测试
  5. 测试覆盖率低于阈值时 CI 阻止合并
- 回归风险：
  - 测试用例本身可能有 bug，导致误报或漏报
  - CI 环境与本地环境差异可能导致测试不稳定
  - 小程序自动化测试工具版本更新可能导致测试脚本失效
- 关联任务：P2-1 代码去重（medication 拆分后再编写测试更合理）
