# 自动化检查基线

执行日期：2026-08-11

## 单元测试

命令：

```powershell
npm test -- --runInBand
```

结果：退出码 `1`。

| 指标 | 结果 |
| --- | --- |
| 测试套件 | 15 通过，1 失败，共 16 个 |
| 测试用例 | 355 通过，2 失败，共 357 个 |
| 失败文件 | `tests/unit/page-data-consistency.test.js` |

失败项：

1. `trend.metricOptions` 测试预期 3 个指标（`bloodPressure`、`bloodGlucose`、`medication`），当前默认数据为 2 个指标（`bpBg`、`medication`）。
2. `trend.activeMetric` 测试预期 `bloodPressure`，当前默认值为 `bpBg`。

结论：趋势页默认数据与一致性测试的契约不同步。家庭权限二开开始前不应把测试状态表述为“全部通过”。

## ESLint

命令：

```powershell
npm run lint
```

结果：退出码 `1`，共 46 个问题，其中 12 个错误、34 个警告。

错误集中在未使用变量与一处宽松相等比较：

- `services/data-rights.js`
- `services/family.js`
- `services/medication-confirm.js`
- `services/medication-merge.js`
- `services/records.js`
- `services/report.js`
- `utils/chart-adapter.js`

说明：`services/family.js` 已有一个未使用的 `writeStorage` 导入。修改家庭权限相关逻辑时，应一并确认它是应删除的遗留依赖，还是后续流程需要使用的写入入口。

## 云函数回归脚本

命令：

```powershell
npm run regression
```

结果：退出码 `1`。

异常：`scripts/health-api-regression.js:295` 的 `testMedicationService` 读取未定义数据的第一个元素，报错：

```text
TypeError: Cannot read properties of undefined (reading '0')
```

结论：云函数回归脚本目前不能作为通过性证据。后续应先定位其期望响应与实际响应的差异，再将修复后的完整输出存入本目录。

