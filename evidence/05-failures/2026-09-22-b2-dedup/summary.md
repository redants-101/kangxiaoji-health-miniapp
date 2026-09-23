# B2 回归脚本逻辑去重 · 记录（summary）

- 批次：实施批次 3 / B2（停止回归脚本复制业务权限逻辑）
- 日期：2026-09-22（执行时段 10:19–10:55，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 执行平台：在 Zcode 上执行，底层模型仍为豆包模型——仅作执行环境记录，不展开。
- 范围声明：本轮只做"回归脚本与云函数真实实现共享同一套纯逻辑"，未实现 A0/A1，未改 read/write/remind 业务语义，未升 Node18，未修 settings 测试，未清 Lint，未改云端配置，未提交、未部署、未切分支。

## 1. 复制逻辑的根因

回归脚本为了在**不启动云函数运行时**的情况下本地跑通，把家庭权限相关的默认值/权限判断/归一化/校验函数**手抄了一份**（重构前 `scripts/health-api-regression.js` L186-L246、L371-L428 等共 16 组）。手抄副本随后与真实实现漂移：

- 结构性残缺：`getDefaultFamilyScopes` 副本缺每项 `meta`；`getDefaultNoticeRules` 副本只有 1 条而真实 3 条；`getDefaultInviteRelations` 副本只有 daughter 而真实 4 项；
- 校验规则残缺：副本 `validateMedicationPlanPayload` 缺 times 非空/≤8、HH:mm、endDate 等校验；`validateMedicationConfirmationPayload` 缺 status 枚举校验；
- 上下文查询残缺：内联 `getFamilyAccessContext` 只有 family_members 分支，真实实现还有 ownerPreview 回退（云函数 index.js 原 L639-L658）。

结果：本地回归名义上在保护用药/家庭接口，实际保护的是一份**更弱的旧副本**，真实业务规则不受回归约束。逐项差异与证据见 `logic-comparison.md`。

直接 `require('./cloudfunctions/healthApi/index.js')` 不可行（已实测）：加载即执行 `wx-server-sdk` 的 `cloud.init`，云环境外 `DYNAMIC_CURRENT_ENV` 为 undefined；且 index.js 只导出 `main`，拿不到任何纯函数。

## 2. 实际共享模块与引用方案

在云函数目录内新增 **3 个无 `wx-server-sdk`、无初始化/网络副作用**的纯模块（随 healthApi 部署，不引入云外路径）：

| 模块 | 内容 |
|---|---|
| `cloudfunctions/healthApi/payload-helpers.js` | `CHINA_TIME_OFFSET_MS`、`getTodayDateValue`、`buildLogId`、`getRecordStatus`、`assertPayloadObject`、`getLimitedString`、`getRequiredNumber`、`getOptionalNumber`、`isValidTime`、`getEnumValue`、db 工厂 `createAssertOwnedDocument(db)` |
| `cloudfunctions/healthApi/payload-validation.js` | 血压/血糖/用药计划/用药确认四个 `validate*`（从 index.js 逐字迁入） |
| `cloudfunctions/healthApi/family-policy.js` | 默认成员/scopes/noticeRules/关系、`isScopeEnabled`、`isRelationScopeEnabled`、`getScopeText`、两个 `normalize*`、邀请码校验，以及 db 工厂 `createProfileDisplayName`、`createFamilyAccessContext`（含 ownerPreview 分支） |

引用关系：

- **index.js**：删除上述函数的内联定义，改 require 后按**原键名、原签名**注入各 service；`getOpenId`、`createRecordId`、`createInviteCode`、路由表、`main` 不动；提醒设置域的 `getDefaultReminderSettings`、两个非权限归一化函数保留在 index.js（非本轮目标，见第 6 节）。
- **medication-service.js**：本地 `getTodayDateValue`/`buildLogId`/常量删除，改 require payload-helpers。
- **record-service.js**：本地 `CHINA_TIME_OFFSET_MS` 改 require payload-helpers，`toChinaDateStr` 不动。
- **回归脚本**：16 组副本/桩全部删除，改 require 三个共享模块注入；`createInviteCode: () => 'INVITE001'` 与 `_.in` 保留为**确定性测试替身**（让 join 断言不依赖随机码/真实命令），不是业务逻辑复制。

行为等价性保证：真实函数是逐字搬迁，注入键名与签名不变；回归脚本从"弱副本"换成"真实函数"，覆盖面只增不减。

## 3. B1/B4 改动未被覆盖的核实

| 来源 | 文件/证据 | 本轮处置 |
|---|---|---|
| B1 | `scripts/health-api-regression.js` 的北京日期夹具修复（before/after/fix.patch 在 b1-regression/） | 重写脚本时**完整保留**其行为：用药夹具仍带当天 `confirmDate`（现由共享 `getTodayDateValue` 生成），家属计划夹具仍带 `status:'启用'` |
| B4 | `tests/unit/page-data-consistency.test.js` 两处 bpBg 断言 | 本轮**零改动**；重跑仍 7/7 通过 |

为确保本轮 fix.patch 不混入 B1，补丁是在临时树先**重放 B1 patch** 得到 B1 态脚本、再与现脚本 diff 生成（云端 3 文件改动 + 3 个新模块同段收录），共 7 个 diff 段。

## 4. 测试结果（均为真实退出码）

| # | 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|---|
| 改前 | `npm run regression` | 0 | ok（B1 基线） | `before.txt` |
| 1 | `npm run regression` | **0** | `health-api-regression: ok` | `after.txt` |
| 2 | `npm test -- --runInBand tests/unit/page-data-consistency.test.js` | 0 | **7/7**（B4 保持通过） | `related-tests.txt` |
| 3 | 加 family/medication/page-data 相关单测 | 0 | **71/71**，4 套件全过 | `related-tests.txt` |
| 4 | `npm test -- --runInBand`（全量） | **0** | **357/357，16 套件全过** | `full-test.txt` |

B1 四组测试（testPerfSchema / testMedicationService / testFamilyService / testSettingsDataService）在重构后仍被 `main()` 顺序 await 实际执行——脚本中无 try/catch 吞错，任一失败都不会打印 ok，而 ok 已打印、退出码 0。

"同一逻辑"的额外取证：

- 回归脚本已无 `getDefaultFamily*`、`validateMedication*`、`assertOwnedDocument`、`getFamilyAccessContext` 等任何业务函数定义（grep 仅命中一个委托真实工厂的计数包装）；
- 引用相等实测：两侧拿到的 `getScopeText`、`validateMedicationPlanPayload` 为同一函数引用（`true`）；
- 共享模块加载后 `wx-server-sdk` **不在** require 缓存中（实测 false），证明无副作用；
- 补丁可应用性：在隔离临时树按 HEAD → B1 → B4 → B2 顺序打补丁，三段全部干净应用，且应用后 7 个文件与当前工作区逐字一致。

## 5. settings.test.js 的独立限制

- 本轮执行前（北京 10:19）单独运行 `tests/unit/settings.test.js`：**22/22 通过、退出码 0**（输出 `settings-before.txt`）。此刻 UTC 与北京同为 9-22。
- 该测试对执行时段敏感：夹具用 `new Date().toISOString()`（UTC 日期）写 confirmDate，服务端按北京日期过滤；北京 00:00–08:00（UTC 仍是前一天）会出现 2 个失败（B4 凌晨批次已记录该现象与证据）。
- 该问题与 B2/B4 均无因果关系，本轮**未修复**；当前全量 Jest 全绿，但应另建台账统一 UTC/北京时区口径。

## 6. 未执行项 / 仍存在的限制

- **不抽取**：`testSettingsDataService` 中提醒设置页的 `getDefaultReminderSettings`、`normalizeReminderSettingsPayload` 简化副本，属提醒页默认数据、非权限逻辑，为控制爆炸面保留，登记为后续可选去重。
- 未实现 A0（三级 scopes/8 关系/白名单/删 missedNotice）与 A1（1:1、family_auth 修复、注销连带）；家庭权限仍处于"未实施"状态，本轮未改变任何相关行为。
- 未升 Node18（A-1 独立阶段）；Lint 历史台账 12 error/34 warning 本轮未重跑、未处理。
- 全部为本地 Jest 与本地 Mock 验证：不连真实云数据库，未验证 _openid 归属、安全规则、索引、频控、真实邀请链路；本地通过不等于云端验证通过。未做开发者工具编译/真机验证，未部署。

## 7. 累计未提交改动（截至本轮结束）

已跟踪改动 4 个文件 + 3 个新文件，全部未暂存、未提交：

| 文件 | 来源批次 |
|---|---|
| `scripts/health-api-regression.js` | B1（行为保留）+ B2（去重重写） |
| `tests/unit/page-data-consistency.test.js` | B4（本轮零改动） |
| `cloudfunctions/healthApi/index.js` | B2 |
| `cloudfunctions/healthApi/medication-service.js` | B2 |
| `cloudfunctions/healthApi/record-service.js` | B2 |
| `cloudfunctions/healthApi/payload-helpers.js` | B2（新增） |
| `cloudfunctions/healthApi/payload-validation.js` | B2（新增） |
| `cloudfunctions/healthApi/family-policy.js` | B2（新增） |

未跟踪项仍为既有的 `docs/家庭Tab开放与三级权限只读分析.md` 与 `evidence/`。
