# B2 等价性复核报告

- 复核日期：2026-09-22（10:52–11:20，UTC+8）
- 对象：B2（实施批次 3）新增的 `payload-helpers.js`、`payload-validation.js`、`family-policy.js`，以及 index.js / medication-service.js / record-service.js 的引用变化
- 对照基准：`HEAD`（`a751776`）中的原始实现，方法为提取 HEAD 源码中的函数声明文本与共享模块导出函数做**逐字级比对**（空白归一化），而非仅靠"同一引用"推断
- 复核工具一次性脚本在 `.b3tmp/`（仓库内临时目录，复核结束后删除），未修改任何业务文件

## 1. 执行环境与工作区（已跟踪 / 新增未跟踪分列）

- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- Node：v22.23.2，`C:\Users\123\AppData\Local\DoubaoWork\User Data\sandbox_runtime\bases\c98c5042338ed152c6f10ecd8591889f\node\node.exe`；npm 10.9.8（经同目录 npm-cli.js 调用）

**已跟踪修改**（`git diff --name-only`，5 个）：

- cloudfunctions/healthApi/index.js（B2）
- cloudfunctions/healthApi/medication-service.js（B2）
- cloudfunctions/healthApi/record-service.js（B2）
- scripts/health-api-regression.js（B1 行为 + B2 去重）
- tests/unit/page-data-consistency.test.js（B4）

**新增未跟踪代码**（不在 `git diff --stat` 内，3 个）：

- cloudfunctions/healthApi/payload-helpers.js（B2）
- cloudfunctions/healthApi/payload-validation.js（B2）
- cloudfunctions/healthApi/family-policy.js（B2）

## 2. 纯函数逐字比对结果：22/22 一致

从 HEAD index.js 提取每个函数的完整声明（参数列表先做括号配平，再对函数体做花括号配平），与共享模块导出函数的 `toString()` 做空白归一化比对：

| 结果 | 函数（22 个） |
|---|---|
| IDENTICAL ×22 | getTodayDateValue、buildLogId、getRecordStatus、getLimitedString、isValidTime、getEnumValue、assertPayloadObject、getRequiredNumber、getOptionalNumber、getDefaultFamilyMember、getDefaultFamilyScopes、getDefaultNoticeRules、getDefaultInviteRelations、getInviteRelation、isScopeEnabled、isRelationScopeEnabled、getScopeText、normalizeFamilyAuthPayload、normalizeFamilyInvitePayload、validateInviteCodePayload、validateMedicationPlanPayload、validateMedicationConfirmationPayload |

过程中脚本一度报两个 normalize 函数 DIFFERENT，查明是**提取器自身缺陷**（默认参数 `payload = {}` 的花括号被提前计数导致截断），修正提取器后两者一致——非代码差异。

## 3. db 依赖函数比对：3/3 等价（含闭包改工厂的差异定性）

| HEAD 函数 | 现形态 | 结论 |
|---|---|---|
| `assertOwnedDocument`（闭包引用 index 顶层 `db`） | `createAssertOwnedDocument(db)` 工厂返回函数 | **IDENTICAL**（连参数命名都未变，仅包一层工厂） |
| `getProfileDisplayName`（闭包 `db` + 常量 `COLLECTIONS`） | `createProfileDisplayName({db, collections})` | 归一化标识符后 **IDENTICAL**：唯一文本差异是 `COLLECTIONS`→形参 `collections`，注入时传入的是同一个集合名对象 |
| `getFamilyAccessContext`（含 ownerPreview 回退 L639-L658） | `createFamilyAccessContext({db, collections})` | 同上，归一化后 **IDENTICAL**；member 与 ownerPreview 两条分支、mode 字段、revoked 判定逐字保留 |

参数、默认值、返回结构、错误条件与错误信息均未变；日期口径（北京时间、加偏移后用 UTC 方法）一致；数据库查询条件（where/orderBy/limit）一致。

## 4. 引用与注入核对（index.js）

- index.js 顶部按名 require 三个共享模块，装配各 service 时使用的**注入键名与 B2 前完全一致**（对照 HEAD 各 createXxxService 入参逐个核对）；
- 无悬空引用：index.js 中对已删除内部符号（isScopeEnabled、getInviteRelation、assertPayloadObject、getRequiredNumber、getOptionalNumber、isValidTime、getEnumValue）引用计数均为 0；`CHINA_TIME_OFFSET_MS` 仅 2 处（均在 getHomeData 的本周计算内）且已改为从 payload-helpers 引入；
- 保留在 index.js 的 `getOpenId`、`createRecordId`、`createInviteCode`、`getDefaultReminderSettings`、`getDefaultProfileRoles`、`getDefaultFocusItems`、`normalizeProfilePayload`、`normalizeReminderSettingsPayload` 与 HEAD 文本一致；
- 提取的三个模块均位于 `cloudfunctions/healthApi/` **部署目录内**（部署时随包上传，无云外路径）。

## 5. 循环依赖 / 加载副作用

- 对 healthApi 目录做 require 插桩：第一方模块中**未检测到循环依赖**；检测到的 9 处循环 require 全部位于 `node_modules/@cloudbase`、`sshpk`、`protobufjs` 内部（第三方既有，与本轮无关）。
- 第一方引用为干净 DAG：`payload-helpers`（无本地依赖）← `payload-validation` / `family-policy` ← `index.js` 及各 service。
- 独立进程只加载三个共享模块：`wx-server-sdk` **不在** require 缓存，且只加载这 3 个文件——无 init、无网络。index.js 加载时会加载 wx-server-sdk，属其本身职责，非共享模块引入。

## 6. 回归脚本真实调用共享实现

- 脚本中已无 `getDefaultFamily*`、`validateMedication*`、`assertOwnedDocument`、`normalizeFamily*`、`getFamilyAccessContext` 等任何业务函数定义；唯一保留的 `getProfileDisplayName`（L312）是委托真实工厂的**计数包装**（用于断言 join 复用 ownerName），非逻辑副本；
- 注入 family-service 的 16 项依赖均 require 自共享模块；用药/家庭 service 与云端 index.js 装配用的是**同一份模块文件**；
- `createInviteCode: () => 'INVITE001'`、`_.in` 为确定性测试替身（固定随机产物/命令），已在代码中注明，不是业务逻辑复制。
- 注：medication-service 内 getMedHistory 使用了 `_`（L444-L445），回归脚本未注入 `_`；该处不在回归当前执行路径中，属原有状况（B2 未改变），登记为覆盖缺口而非回归故障。

## 7. 发现项分类（按要求三分类）

| # | 发现 | 分类 | 处置 |
|---|---|---|---|
| 1 | 22 纯函数 + 3 db 函数与 HEAD 等价 | 原行为保留 | 无需改动 |
| 2 | family-service.js、settings-data-service.js 仍各自内置 `getTodayDateValue`；daily-stats/report/family/settings-service 仍各自内置 `CHINA_TIME_OFFSET_MS` | **原有问题**（HEAD 即存在，B2 未新增也未消除） | 本轮不改业务规则，登记台账，建议后续收敛到 payload-helpers |
| 3 | 回归脚本未注入 medication-service 的 `_`，getMedHistory 命令路径无本地覆盖 | **原有问题/覆盖缺口** | 登记，不宣称该路径已被回归覆盖 |
| 4 | settings.test.js 对 UTC/北京跨日时段敏感 | **原有问题** | 本轮不修；见各批次记录 |
| 5 | 当前 enabled 模型下 scopes 默认全开、关系白名单仍为旧 4 项 | 原行为保留（A0 才改） | 测试按现行为写，不提前写三级契约 |

## 8. 复核结论

B2 的共享模块提取在函数文本、参数/返回/错误条件、日期口径、查询条件与 ownerPreview 分支层面与 HEAD 原实现**逐项等价**，未发现"本次无意改变"项；第一方模块无循环依赖、共享模块无加载副作用；回归脚本确实使用共享实现而非副本。剩余问题全部为 HEAD 既有的其他副本与覆盖缺口，已分类登记，未借复核修改业务规则。

局限：本复核是**静态文本 + 本地加载**证据，能证明"提取未改变这些函数"，但不能替代真实云环境运行；对执行路径之外的函数分支（如 medHistory 的 `_` 查询）不构成覆盖。
