# B4 趋势测试契约对齐 · 记录（summary）

- 批次：实施批次 2 / B4（趋势失败测试与 bpBg 复合指标契约对齐）
- 日期：2026-09-22（执行时段 01:51–02:10，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 决策依据：`evidence/02-repo-analysis/2026-09-22/decisions.md` 第 14 项——"以 bpBg 复合指标新模型为准，更新 page-data-consistency.test.js 两处断言"，不回退业务实现。
- 范围声明：本轮**只修改** `tests/unit/page-data-consistency.test.js`（1 个文件）；未改业务实现、依赖、运行时、云端配置；未提交、未推送、未部署、未切分支；未夹带 B2 回归脚本去重与任何 Lint 清理；B1 对 `scripts/health-api-regression.js` 的修改原样保留。

## 1. 执行环境（已重新核实）

| 项 | 值 |
|---|---|
| Node 版本 / 路径 | v22.23.2 / `C:\Users\123\AppData\Local\DoubaoWork\User Data\sandbox_runtime\bases\c98c5042338ed152c6f10ecd8591889f\node\node.exe` |
| npm 版本 | 10.9.8（同目录运行时，npm 子进程与命令行同一套 Node） |
| 机器上其他 Node（本期未用） | 系统 `D:\software\nodejs` v24.16.0/11.13.0；nvm v20.16.0 |

## 2. 契约核实（断言更新有产品契约依据，非盲从实现返回值）

bpBg 复合指标契约在全链路一致：

- `services/page-data.js` L61-L71：`metricOptions=[{bpBg,血压血糖},{medication,用药}]`，`activeMetric='bpBg'`，`activeRange='7d'`。
- `services/report.js` L422/L506/L522-L523/L548：`getTrendData(metric='bpBg', range='7d')`，bpBg 为血压+血糖复合指标、双图表数据。
- `pages/trend/index.js` L18-L21/L103/L175-L185、`pages/trend/index.wxml` L23-L38/L134：页面只渲染 bpBg、medication 两个指标切换，默认 bpBg。
- `tests/unit/report.test.js` L357-L435：已有 10+ 个趋势用例按 bpBg 契约断言（metricOptions 长度 2、默认 bpBg+7d、bpBg 双图表）。

结论：落后于契约的是 page-data-consistency 中两处旧断言（三指标 bloodPressure/bloodGlucose/medication、默认 bloodPressure），更新方向由 decisions.md 第 14 项明确授权。

## 3. 命令、退出码与统计

| # | 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|---|
| 修复前 | `npm test -- --runInBand tests/unit/page-data-consistency.test.js` | 1 | 2 failed / 5 passed，共 7 | `before.txt` |
| 验证 1 | 同上（修复后） | **0** | **7 passed / 7** | `target-after.txt` |
| 验证 2 | `npm test -- --runInBand`（全量） | 1 | **355 passed / 2 failed**，共 357；15 个套件通过、1 个失败，共 16 | `test-after.txt` |
| 验证 3 | `npm run regression` | **0** | `health-api-regression: ok`（B1 四组用例全通过，未回退） | `regression-after.txt` |

修复前两处失败原文（before.txt）：
- `metricOptions` 期望长度 3，实际为 2；
- `activeMetric` 期望 `"bloodPressure"`，实际收到 `"bpBg"`。

## 4. 实际修改（完整 diff 见 fix.patch，仅 1 个文件、两处用例）

`tests/unit/page-data-consistency.test.js`：

1. 用例"trend.metricOptions 包含三个指标"→ 改名"**包含血压血糖复合指标和用药指标**"；断言由"长度 3 + 键序 [bloodPressure,bloodGlucose,medication]"更新为对完整对象的精确匹配：
   `[{key:'bpBg',label:'血压血糖'},{key:'medication',label:'用药'}]`（比旧断言更严格，非放宽为"存在"判断）。
2. 用例"trend 默认值为 7天+血压"→ 改名"**7天+血压血糖**"；`activeMetric` 断言由 `'bloodPressure'` 更新为 `'bpBg'`；`activeRange` 仍断言 `'7d'`（未变）。

未删除/跳过任何用例，未改动其余 5 个有效断言（report 键不存在、trend 完整字段、rangeOptions 三档、reminder 路由与标题），未修改任何业务实现。

## 5. 全量 Jest 中 2 个失败的定性：与本轮无关，未顺手修复

失败用例均在 `tests/unit/settings.test.js`（非本轮修改文件）：

- `mergeLocalCompletedTasks › 有今日已确认记录时添加到已完成分组`（L300）
- `mergeLocalCompletedTasks › 跳过状态的确认记录也加入已完成分组`（L319）

根因（已实测取证）：测试夹具用 `new Date().toISOString().slice(0,10)` 取 **UTC 日期**写 `confirmDate`，而服务 `services/settings.js` L118/L129 用 `getTodayDateValue()`（**北京日期**）过滤。本轮执行时刻北京为 2026-09-22 凌晨、UTC 仍为 2026-09-21：

```
UTC ISO date: 2026-09-21
Beijing today: 2026-09-22
```

日期错配 → 过滤结果为 0 条 → 断言长度 1 失败。2026-09-21 基线 18:23（北京）执行时 UTC 与北京同为 09-21，故当时通过；这是一个对执行时段敏感的既有测试缺陷，与 B4 改动无因果关系（B4 只改另一个测试文件）。按任务要求**不在本轮修复**，建议另建台账项（UTC/北京时区口径统一），白天时段（北京 08:00 后）重跑应自行转绿。

## 6. 累计未提交改动（截至本轮结束）

已跟踪改动 2 个文件：

| 文件 | 来源批次 | 本轮状态 |
|---|---|---|
| `scripts/health-api-regression.js` | B1 | 保留，本轮零改动 |
| `tests/unit/page-data-consistency.test.js` | **B4（本轮新增）** | 新增修改，diff 13 行（+7/-6） |

未跟踪项（均为既有，原样保留）：`docs/家庭Tab开放与三级权限只读分析.md`、`evidence/`。无 staged、无 stash、无提交。

## 7. 仍存在的限制

- **Lint**：基线台账 12 error / 34 warning（2026-09-21 lint.txt）继续保留，本轮**未重跑、未处理**；按纠正后的任务编号，B2 是回归脚本与真实实现的逻辑去重，不是 Lint 修复，历史 Lint 问题留待后续批次。
- **云端验证**：本轮全部为本地 Jest 与本地 Mock 回归，不连真实云数据库，未验证云函数 _openid 归属、安全规则、inviteCode/attempts 索引、频控与真实邀请链路；本地通过不等于云端验证通过。
- 未做微信开发者工具编译、预览、真机或双账号验证；未进行 Node18 运行时升级（属后续 A-1 独立阶段）。
