# B2 逻辑对比与去重方案（实施前分析）

- 日期：2026-09-22（10:19–10:35，UTC+8）
- 对象：`scripts/health-api-regression.js`（回归脚本，本地 Mock 执行）与 `cloudfunctions/healthApi/index.js`（云函数真实装配/默认值/归一化实现）
- 平台说明：本轮在 Zcode 上执行、底层模型仍为豆包模型，仅作为执行环境记录。

## 1. 两份逻辑逐项差异

| # | 逻辑 | 回归脚本位置 | 真实实现位置 | 差异与漂移风险 |
|---|---|---|---|---|
| 1 | `getTodayDateValue`（北京日期串） | L28-L37（B1 新增） | index.js L25-L34；**另有第三份** medication-service.js L8-L18 | 三份实现当前一致；任何一份改动都会漂移 |
| 2 | `getDefaultFamilyMember` | L195-L197 | index.js L340-L348 | 副本缺 `desc`（默认成员说明）字段 |
| 3 | `getDefaultFamilyScopes` | L187-L192/L198-L200 | index.js L354-L381 | 副本四项只有 key/title/enabled，缺每项 `meta` |
| 4 | `getDefaultNoticeRules` | L201-L203 | index.js L387-L408 | 副本仅 1 条（missedMedicine）；真实 3 条（missingRecord、weeklyReport 及各自 meta/默认开关全缺） |
| 5 | `getDefaultInviteRelations` | L204-L206 | index.js L528-L535 | 副本仅 daughter 1 项；真实 4 项（son/spouse/other 缺失） |
| 6 | `getScopeText` | L207-L211 | index.js L572-L578 | 当前逻辑一致（仍是副本） |
| 7 | `isRelationScopeEnabled` | L212-L215 | index.js L563-L565（真实经 `isScopeEnabled` L552-L555 委托） | 当前结果等价；真实多一层可复用的 auth 形态判断 |
| 8 | `getLimitedString` | L219-L224 | index.js L302-L311 | 一致（纯文本断言） |
| 9 | `validateMedicationPlanPayload` | L226-L235（**简化副本**） | index.js L766-L794 | 副本缺：payload 对象断言、times 非空/≤8 校验、HH:mm 格式校验、endDate 校验、times 去重；回归实际没有覆盖真实校验规则 |
| 10 | `validateMedicationConfirmationPayload` | L237-L246（**简化副本**） | index.js L801-L817 | 副本缺：对象断言、status 枚举（taken/skipped/snoozed）校验、状态文案映射 |
| 11 | `assertOwnedDocument` | L248-L255（简化副本，签名多一个 db 参数） | index.js L588-L600 | 副本缺空 documentId 拦截；查询逻辑一致 |
| 12 | `getProfileDisplayName` | L373-L377（家属用例内联） | index.js L607-L613 | 当前逻辑等价（profiles 查询 + '家人' 兜底） |
| 13 | `getFamilyAccessContext` | L379-L390（**简化内联副本**） | index.js L620-L659 | 副本只有 family_members 查询；真实还返回 `mode`，并在无 active 关系时回退 family_auth 的 ownerPreview 分支（L639-L658），整段权限预览逻辑没有被回归覆盖 |
| 14 | `normalizeFamilyAuthPayload` | L406-L414（注入的桩） | index.js L683-L697 | 桩不做 member 默认值合并、不做 scopes/noticeRules 数组校验 |
| 15 | `normalizeFamilyInvitePayload` | L415-L425（注入的桩） | index.js L834-L854 | 桩不做关系解析（getInviteRelation）、scope 过滤、"至少一项授权"校验 |
| 16 | `validateInviteCodePayload` | L426（注入的桩） | index.js L824-L827 | 桩不做对象断言与必填校验 |
| 17 | `buildLogId` | 未复制（脚本不直接用） | index.js L36-L38；medication-service.js L20-L22 | 云端内部已有两份，顺手收敛到同一模块 |

另有两类**本轮不抽取**的副本/桩（在文末第 5 节说明）。

## 2. 直接 require index.js 的副作用（已实测，不臆测）

实测命令（Node v22.23.2，云函数目录外）：

```
node -e "require('./cloudfunctions/healthApi/index.js')"  → REQUIRE_OK（加载本身不抛错）
```

但加载即触发以下顶层副作用（index.js L12-L21）：

1. `require('wx-server-sdk')`（解析到 `cloudfunctions/healthApi/node_modules`）；
2. `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`——云环境外实测 `cloud.DYNAMIC_CURRENT_ENV === undefined`，即对 undefined 环境执行 init；
3. `cloud.database()` 立即创建数据库句柄；云环境外任何真实操作报：
   `collection.get:fail -501007 invalid parameters. missing secretId or secretKey of tencent cloud`；
4. index.js 只 `exports.main`，**不导出**任何辅助函数，require 之后拿不到默认值/归一化函数。

结论：**不能直接 require index.js 复用逻辑**——即使不抛错，也承担了 wx-server-sdk init 副作用，且导出面为零。按任务给定的备选，采用"独立无副作用纯模块 + 两边共同引用"。

## 3. 最小安全去重方案

在云函数目录内新增 3 个无 `wx-server-sdk` 依赖、无任何初始化副作用的模块（部署时随 healthApi 一起上传，不引入云外路径）：

1. **`payload-helpers.js`**：通用纯函数与一个 db 工厂
   - 常量 `CHINA_TIME_OFFSET_MS`；`getTodayDateValue`、`buildLogId`、`getRecordStatus`；
   - 入参断言原语：`assertPayloadObject`、`getLimitedString`、`getRequiredNumber`、`getOptionalNumber`、`isValidTime`、`getEnumValue`；
   - `createAssertOwnedDocument(db)`：绑定 db 的归属校验工厂，返回签名 `(collection, openId, documentId, label)`。
2. **`payload-validation.js`**：`validateBloodPressurePayload` / `validateBloodGlucosePayload` / `validateMedicationPlanPayload` / `validateMedicationConfirmationPayload`（从 index.js 原样迁入，仅改 require 来源）。
3. **`family-policy.js`**：家庭权限域
   - 纯函数：`getDefaultFamilyMember` / `getDefaultFamilyScopes` / `getDefaultNoticeRules` / `getDefaultInviteRelations` / `getInviteRelation` / `isScopeEnabled` / `isRelationScopeEnabled` / `getScopeText` / `normalizeFamilyAuthPayload` / `normalizeFamilyInvitePayload` / `validateInviteCodePayload`；
   - db 工厂：`createProfileDisplayName({ db, collections })`、`createFamilyAccessContext({ db, collections })`。

装配侧改动：

- **index.js**：删除上述函数的内联定义，改为 require 共享模块后按原键名注入各 service；`getOpenId`、`createRecordId`、`createInviteCode`、路由表与 `main` 不动。
- **medication-service.js**：删除本地 `CHINA_TIME_OFFSET_MS` / `getTodayDateValue` / `buildLogId`，从 payload-helpers 引入（行为逐字不变）。
- **record-service.js**：本地 `CHINA_TIME_OFFSET_MS` 改为从 payload-helpers 引入（其 `toChinaDateStr` 不动）。
- **回归脚本**：删除第 1 表中 1-16 项全部副本/桩，改为 require 共享模块并注入；`createInviteCode: () => 'INVITE001'` 保留为**确定性测试替身**（它不是业务逻辑的搬运，而是为了让 join 断言不依赖随机码）；`_: { in }` 同理是 Mock 命令替身。

业务行为保持不变：真实函数是逐字搬迁，注入键名与签名全部不变；回归脚本从"用简化副本"变为"用真实函数"，覆盖面只增不减。

## 4. 需要修改的文件

| 文件 | 性质 |
|---|---|
| `cloudfunctions/healthApi/payload-helpers.js` | 新增 |
| `cloudfunctions/healthApi/payload-validation.js` | 新增 |
| `cloudfunctions/healthApi/family-policy.js` | 新增 |
| `cloudfunctions/healthApi/index.js` | 删除内联实现、改 require |
| `cloudfunctions/healthApi/medication-service.js` | 3 个本地件改 require |
| `cloudfunctions/healthApi/record-service.js` | 1 个常量改 require |
| `scripts/health-api-regression.js` | 删除副本/桩，改 require 共享模块 |

不动：B1 之外的业务语义、B4 的测试文件、云端配置、依赖与运行时。

## 5. 如何证明回归脚本用的是与业务实现相同的逻辑

1. 静态证据：`grep` 回归脚本，第 1 表 1-16 项函数定义全部消失，只剩对三个共享模块的 require 与注入；
2. 同一来源：index.js 注入 family/medication service 的函数与回归脚本注入 Mock service 的函数 require 自同一文件路径（可用 `node -e` 比较 `require(...) === require(...)` 引用相等）；
3. 行为证据：回归改用**真实** `validateMedication*`、`normalizeFamily*`、`getFamilyAccessContext`（含 ownerPreview 分支）后，四组用例退出码仍为 0；
4. 无副作用证据：`node -e "require('./cloudfunctions/healthApi/payload-helpers')..."` 不触发任何 init/网络（模块内无 wx-server-sdk）。

## 6. 本轮明确不抽取 / 不处理项

- `testSettingsDataService` 中注入的 `getDefaultReminderSettings` / `normalizeReminderSettingsPayload` 简化副本：属提醒设置页默认数据，**不是权限逻辑**，为控制本轮爆炸面不抽取，登记为后续可选去重项。
- 不实现 A0/A1（三级 scopes、8 关系、1:1 等均保持未实施状态）；不改 read/write/remind 语义；不升 Node18；不修 settings.test.js；不清 Lint；不改云端配置；不部署。
