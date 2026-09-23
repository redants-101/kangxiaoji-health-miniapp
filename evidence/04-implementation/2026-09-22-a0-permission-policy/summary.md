# 实施批次 5 · A0-1 三级权限规则与直接测试 · 摘要

- 日期：2026-09-22（11:18–11:55，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 环境：Node v22.23.2 / npm 10.9.8（豆包会话运行时）；B1/B4/B2/B3 改动全部保留；未提交、未部署、未升级运行时、未切分支。

## 1. 本轮新增规则（全部在 family-policy.js 内独立命名，旧函数零改动）

| 规则 | 函数 | 要点 |
|---|---|---|
| 八种家属关系 | `FAMILY_RELATIONS_V2`、`getFamilyRelationV2` | daughter/son/spose→daughter/son/spouse/granddaughter/grandson/sibling/caregiver/other；第 8 项 key 沿用 `other`、文案改为"家属/共同管理"；未知 key 返回 null |
| scopes 归一化 | `normalizeFamilyScopesV2` | 四 key 白名单、固定输出顺序；read/write/remind 只认严格布尔、缺失默认 false；未知 key、非数组、非对象、重复 key 拒绝；旧 `enabled` 字段忽略不映射；标题/用途由固定目录生成 |
| 提醒规则归一化 | `normalizeNoticeRulesV2` | missedMedicine/missingRecord/weeklyReport 三维布尔，缺失 false、非布尔拒绝、多余键剔除 |
| 动作判断 | `canPerformScopeAction` | BP 代录/BG 代录/用药代确认/撤销本次代确认需对应 scope **read+write 同时为 true**；计划管理与记录删除不在动作表，恒拒绝；未知动作返回 false 不抛错 |
| 可见性 | `canViewScope`、`canShowPhoneReminder`、`canViewReminderInfo` | 数据可见仅看 read；电话按钮仅看 remind；提醒明细 = scope.read && scope.remind && noticeRules 对应项（missingRecord 为血压或血糖块任一满足） |

派生规则（从已确认决策推出，已在测试固化）：`report` 提交 `write=true` 直接报错"周报不支持代录权限"，避免机械增加周报可写能力；字符串 `"false"`、`"true"`、数字 0/1 等非布尔一律拒绝，不做强制转换。

## 2. 开工前确认的三项业务语义（已按保守口径拍板）

1. **write 是否必须 read**：是，动作判断要求 read+write；
2. **read=false、remind=true 展示什么**：仅电话提醒按钮，不显示提醒明细和数据；
3. **noticeRules 与 scope.remind 关系**：合取，且提醒明细另需 read。

除上述三项外，本批范围内无其他不明确语义。

## 3. 新规则目前未接入生产调用链

`normalizeFamilyScopesV2` 等 8 个新导出**没有被 index.js、family-service.js 或任何页面引用**——它们只被本轮新增测试调用。云函数装配（index.js L185-L189 等）仍注入旧 enabled 模型函数，当前运行行为与 B3 结束时完全一致。这是分批开发的过渡状态：旧 enabled 路径保留供未切换入口使用，**不是最终兼容方案**，A0-2 将整体替换后删除旧函数。

## 4. A0-2 必须一起切换的文件与旧 enabled 残留清单

调用链须同批切换（半切换会导致旧 enabled 文档与新布尔文档混用）：

| 文件 | 残留内容 |
|---|---|
| `cloudfunctions/healthApi/index.js` | 注入旧 `getDefaultFamilyScopes`、`getDefaultInviteRelations`、两个旧 normalize（L185-L189）；装配与路由仍按旧模型 |
| `cloudfunctions/healthApi/family-service.js` | 依赖旧四函数（L23-L27），7 处调用（L270/L370/L407/L438/L448/L521/L652）；含旧 scope.enabled 判断 |
| `cloudfunctions/healthApi/settings-data-service.js` | 注销连带逻辑中对 family_auth/family_members 的 enabled 时代处理 |
| `services/family.js` | 前端本地镜像：关系名单、joinLocal 等（decisions L33-L41/L146-L157） |
| `pages/family-sub/family-invite/index.js` 等家庭页 | 提交/渲染 enabled 结构（含 wxml/wxss） |
| `tests/unit/family.test.js` | 旧关系（4 种）与 enabled 契约断言，须同步改新契约 |

另需注意：`cloudfunctions/sendDueReminders/index.js` 本期保持"只推 owner"，但其内置日期常量与 enabled 概念不参与切换；`services/medication-plan.js`、`pages/medication/med-edit/index.js` 的 `.enabled` 是计划项开关，非权限字段，A0-2 不要误改。切换完成后应删除旧 `getDefaultFamilyScopes`/旧 normalize 等函数而非长期并存。

## 5. 测试结果（真实退出码，测试先行）

| # | 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|---|
| 实现前 | `npm test -- --runInBand tests/unit/a0-permission-policy.test.js` | 1 | **35 失败/0 通过**（函数未实现，符合先失败） | `before.txt` |
| 实现后 | 同上 | **0** | **35/35** | `after.txt` |
| 回归相关 | `npm test -- --runInBand tests/unit/shared-policy.test.js` | 0 | 41/41（旧契约测试未受影响） | `shared-policy-after.txt` |
| B1 护栏 | `npm run regression` | **0** | `health-api-regression: ok`，B1 四组仍实际执行 | `regression-after.txt` |
| 全量 | `npm test -- --runInBand` | **0** | **433/433，18 套件全部通过**（398 存量 + 35 新增） | `full-test.txt` |

新增 35 个用例覆盖：八关系字面契约、完整/最小合法归一化、非数组/未知/非对象/重复拒绝、6 种非布尔值拒绝、enabled 不映射、report 不可写、输入不被修改、重复调用隔离、四种动作允许与 read-only/write-only 拒绝、计划管理/记录删除恒拒、未知动作拒绝、三维 noticeRules、三类提醒的合取与 read 缺失拒绝、read=false+remind=true 仅按钮。预期值全部按确认契约字面填写。

补丁隔离：`fix.patch` 仅含 family-policy.js 的 A0 增量与新测试文件两段；family-policy.js 基准取自临时树重放 B1/B4/B2 补丁后的 B2 态，不含历史批次内容。已验证可在 B3 态树上 `patch -p1` 干净应用，应用后两文件与工作区逐字一致。

## 6. 实际失败 / 未验证项

- 本轮唯一"失败"是实现前预期的 35 个测试失败，已转为全绿；未出现非预期失败。
- **settings 时区问题**：本轮北京上午执行，settings.test.js 22 用例随全量通过；其对北京 00:00–08:00 时段敏感（届时 2 失败）的既有问题仍未处理，未等特定时段、未掩盖。
- **云端边界**：全部为本地 Jest/Mock，未连云数据库；动作判断函数尚未在云函数写路径中执行，代录落库时 `_openid` 归属、安全规则、撤销实时生效、频控、真实邀请链路均未验证；本地 433 全绿不代表云端通过。
- 未做 A1（1:1 绑定、family_auth 修复、注销连带）、邀请码频控、contactPhone/拨号、页面开放、数据库迁移、Node18、Lint（台账 12 error/34 warning）与全仓日期去重。

## 7. 累计未提交改动（截至本轮结束）

已跟踪修改 5 个：index.js、medication-service.js、record-service.js、health-api-regression.js、page-data-consistency.test.js。
新增未跟踪 5 个：payload-helpers.js、payload-validation.js、family-policy.js（本批新增 A0 段落）、shared-policy.test.js、**a0-permission-policy.test.js（本轮）**。另有既有 docs 文档与 evidence/。本轮结束，不进入 A0-2。
