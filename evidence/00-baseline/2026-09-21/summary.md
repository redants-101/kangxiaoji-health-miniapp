# 本期基线检查摘要（2026-09-21）

- 分支：`feat/family-permission`；HEAD：`a751776be194bb0a9d11cf42c27f093ab5109aca`（`code update`）
- 运行环境：豆包会话自带 Node `v22.23.2` + npm `10.9.8`（路径与同源校验见 `environment.md`）
- 结论先行：**三项检查退出码均为 1，现象与 2026-08-11 基线完全一致；业务代码零改动。**

## 1. 命令结果总览

| 命令 | 退出码 | 通过/失败统计 | 结论 |
| --- | --- | --- | --- |
| `npm test -- --runInBand` | 1 | 测试套件 15 通过 / 1 失败（共 16）；用例 355 通过 / 2 失败（共 357）；快照 0；耗时 8.289 s | 未通过，失败点与基线相同 |
| `npm run lint` | 1 | 46 problems：12 errors / 34 warnings | 未通过，问题数与分布与基线相同 |
| `npm run regression` | 1 | 脚本在用药服务用例处抛 `TypeError` 后退出，未跑完全部用例 | 未通过，报错位置与基线相同 |

## 2. 单元测试明细（test.txt）

唯一失败套件：`tests/unit/page-data-consistency.test.js`，失败用例 2 个：

1. `DEFAULT_PAGE_DATA 一致性验证（合并后） › trend.metricOptions 包含三个指标`
   - 断言 `expect(trend.metricOptions).toHaveLength(3)` 失败（test.txt 中位于 36:33）；
   - 期望键顺序 `['bloodPressure', 'bloodGlucose', 'medication']`，当前默认数据为 2 个指标（`bpBg`、`medication`）。
2. `DEFAULT_PAGE_DATA 一致性验证（合并后） › trend 默认值为 7天+血压`
   - 期望 `trend.activeMetric === 'bloodPressure'`，实际为 `'bpBg'`（50:32）。

其余 15 个套件全部通过：report、chart-adapter、settings、snooze、medication、subscribe、records、family、core、data-rights、page-data、pre-check、date-helper、privacy、routes-consistency。

性质：趋势页默认数据结构与一致性测试契约不同步；本期不修复。

## 3. ESLint 明细（lint.txt）

合计 46 个问题（12 errors / 34 warnings）。

12 个 error 全部为未使用变量/导入，外加 1 处宽松相等：

| 文件 | 问题 |
| --- | --- |
| `services/data-rights.js` | 9:3 `writeStorage` 未使用（1） |
| `services/family.js` | 8:3 `writeStorage` 未使用（1） |
| `services/medication-confirm.js` | 12:9 `getStoredMedicationPlans` 未使用；117:10 `normalizeMedConfirmData` 未使用（2） |
| `services/medication-merge.js` | 1:9 `STORAGE_KEYS`、1:23 `readStorage` 未使用（2） |
| `services/records.js` | 8:3 `writeStorage` 未使用（1） |
| `services/report.js` | 2:9 `deepMerge`、2:20 `withMockPageData`、3:49 `dedupeRecords`、356:9 `isWeekly` 未使用（4） |
| `utils/chart-adapter.js` | 131:26 使用了 `==`（要求 `===`，eqeqeq）（1） |

34 个 warning 构成：

- `require-await`（async 方法无 await）25 个，分布在 `pages/` 各页面的 `loadData` 等方法（data 页 4、med-list 3，其余页面各 1）；
- `no-console` 9 个：`pages/home/index.js` 1、`utils/api.js` 1、`utils/onboarding-state.js` 2、`utils/pre-check.js` 5。

未运行 `lint:fix`，未删除任何导入。

## 4. 云函数回归明细（regression.txt）

完整报错：

```text
TypeError: Cannot read properties of undefined (reading '0')
    at testMedicationService (D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu\scripts\health-api-regression.js:295:36)
    at async main (D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu\scripts\health-api-regression.js:523:3)
```

脚本在 `testMedicationService` 读取未定义数据的第一个元素时崩溃，后续用例未执行。该脚本当前不能作为通过性证据；本期不定位、不修复。因脚本在本地数据组装阶段即退出，本轮未产生任何云端调用结论。

## 5. 与 2026-08-11 基线对照（`../test-results.md`）

| 维度 | 2026-08-11（Node v20.16.0 / npm 10.8.1） | 2026-09-21（Node v22.23.2 / npm 10.9.8） | 判定 |
| --- | --- | --- | --- |
| 测试套件 | 15 通过 / 1 失败（共 16） | 15 通过 / 1 失败（共 16） | 相同 |
| 测试用例 | 355 通过 / 2 失败（共 357） | 355 通过 / 2 失败（共 357） | 相同 |
| 失败套件/断言 | `page-data-consistency.test.js`：metricOptions 3 个 vs 2 个、activeMetric `bloodPressure` vs `bpBg` | 完全相同的套件与两条断言 | 相同现象 |
| Lint | 46（12 errors / 34 warnings），错误集中在 data-rights、family、medication-confirm、medication-merge、records、report、chart-adapter | 46（12 errors / 34 warnings），文件与逐条位置一致 | 相同 |
| 回归脚本 | 退出码 1，`health-api-regression.js:295` 读 undefined[0] | 退出码 1，同一函数 `testMedicationService`，位置 295:36，调用栈 main 523:3 | 相同现象（本期多了精确列号/栈行） |
| HEAD | `a751776`（基线记录为干净工作区） | 仍为 `a751776`，被跟踪文件零改动 | 代码无变化 |

- **相同现象**：三项检查的失败用例、问题总数、错误文件与报错位置两期一致。
- **变化项**：仅有运行环境（Node 20 → 22、npm 10.8.1 → 10.9.8）；证据目录新增本期 5 个文件；Git 提交与业务代码无变化。
- **待定位项**（本期不处理）：
  1. 趋势页默认指标契约：以测试为准（3 指标/`bloodPressure`）还是以现有默认数据为准（`bpBg` 合并指标），需产品/设计口径；
  2. `services/family.js` 等文件的未使用导入是遗留依赖还是家庭权限二开将要使用的写入入口（基线文档特别点名 `writeStorage`）；
  3. `health-api-regression.js:295` 期望响应与实际响应的结构差异；
  4. 25 个 `require-await` 与 9 个 `no-console` 是否纳入本期清理范围。
- **归因限制**：两期 Node 大版本不同，即便数值一致也不能把任何差异（未来若出现）直接归因于代码改动或模型升级；后续阶段建议固定同一 Node 版本复跑后再比较。

## 6. 本期新增证据清单

目录：`evidence/00-baseline/2026-09-21/`（新建，未覆盖任何历史文件）

| 文件 | 内容 |
| --- | --- |
| `environment.md` | 日期、工作目录、Git 状态、Node/npm 路径版本与同源校验、限制说明 |
| `test.txt` | `npm test -- --runInBand` 完整原始输出 |
| `lint.txt` | `npm run lint` 完整原始输出 |
| `regression.txt` | `npm run regression` 完整原始输出 |
| `summary.md` | 本摘要 |

业务代码变化：**无**（执行前后 `git diff` 均为空；未提交、未切分支、未清理未跟踪文件）。
