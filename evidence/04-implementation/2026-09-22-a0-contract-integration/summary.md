# 实施批次 6 · A0-2 三级权限契约接入 · 摘要

> **修正说明（2026-09-22 收尾批次追加，原文其余内容保留为历史记录）**
> 1. 本摘要第 1 节当时将"空入参由服务端回退默认 read/remind"记为正确接入；随后确认这是默认放权缺陷——服务端缺失/非法 scopes 不得用页面预选值兜底。已在 `../2026-09-22-a0-contract-followup/` 修正：非数组拒绝、空数组落全 false。本摘要中与该旧行为相关的断言描述以此指针为准。
> 2. `canPerformScopeAction` 规则测试通过不等于写接口已鉴权：真实代录/代确认写路径当时（至今）未接入。
> 3. "lint 无新增"仅适用于 npm run lint 的检查范围（services/utils/pages/components），cloudfunctions 不在该范围内。

- 日期：2026-09-22（11:40–12:20，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 环境：Node v22.23.2 / npm 10.9.8；B1/B4/B2/B3/A0-1 成果全部保留；未提交、未部署、未升级运行时、未切分支。

## 1. 已实际接入的业务入口（5 个，全部实际调用 family-policy V2 规则）

| 入口 | 接入内容 |
|---|---|
| key `familyInvite` | 关系 8 项（`FAMILY_RELATIONS_V2`）、scopes 邀请初始态（read/remind 开、write 关） |
| action `createFamilyInvite` | `normalizeFamilyInvitePayloadV2`：未知关系在入口拒绝；scopes 走 V2 严格校验；family_auth 落三级结构；邀请预览 meta 按 read 生成 |
| key `familyJoin` | 回显 scopes 仅 `read===true` 项；旧无 inviteCode 分支默认 scopes 同样按 read 过滤 |
| action `joinFamilyByInvite` | 加入时 family_members 落 `normalizeFamilyScopesV2` 结果与 `normalizeNoticeRulesV2` 对象；family_auth 转 active |
| key `homeFamily` | 四块逐个 `canViewScope`：关闭块**查询不发起、响应中无对应明细**（血压/血糖受控查询、用药计划与确认计数、周报文案） |
| key/action `familyAuth` + `updateFamilyAuth` | 回显/保存均为 V2 scopes 与 noticeRules 对象；report.write、非布尔、未知/重复 key 在服务入口拒绝；同步 family_members |
| key `family` | owner 成员列表 scope 文案改用 `getScopeTextV2`（按 read） |

关键契约：**noticeRules 统一为对象** `{missedMedicine, missingRecord, weeklyReport}`（存储与接口）；授权页经 `noticeRulesToList` 显式转列表渲染，保存时对象原样提交。旧数组形态在 `normalizeNoticeRulesV2` 被拒绝，不会静默重置或默认放权。

## 2. 尚未接入 / 未提供的新规则与动作（如实列出，不宣传为已可用）

- 代录写路径（recordBloodPressure/recordBloodGlucose 真实落库）、用药代确认/撤销的写入口：规则函数 `canPerformScopeAction` 已被 A0-1 测试覆盖，但**没有任何接口在写路径调用它**，页面也没有可执行入口。
- 电话提醒：`canShowPhoneReminder` 规则就绪，contactPhone 字段、号码回传与 `wx.makePhoneCall` 均未实现；授权页/邀请页不显示电话按钮。
- 二级页（trend/recordList/medHistory 等）家属态只读闭环未做。
- 提醒明细合取规则 `canViewReminderInfo` 目前只被单测调用，未接入任何响应组装。
- write 开关与 read 完全独立：页面不联动；云端在 read 缺失时拒绝动作（集成测试验证）。

## 3. 旧权限引用残留：无

- grep 全仓：旧云端符号（getDefaultFamilyScopes、getDefaultNoticeRules、getDefaultInviteRelations、isRelationScopeEnabled、旧 normalize 名称）引用 **0 处**；missedNotice **0 处**。
- 旧 enabled 权限函数已从 family-policy.js 删除（切换完成不留并存副本）。
- 明确保留的非权限 `.enabled`：services/settings.js、settings-data-service（提醒项）、services/medication-plan.js 与 med-edit 页（计划开关）、sendDueReminders——本批未改动。

## 4. 测试结果（真实退出码；先失败后实现）

| # | 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|---|
| 实现前 | `npm test -- --runInBand tests/unit/a0-contract-integration.test.js` | 1 | **12/12 失败** | `before.txt` |
| 实现后 | 同上 | **0** | **12/12** | `after.txt` |
| 迁移验证 | shared-policy + family | 0 | 62/62，2 套件 | 命令输出 |
| B1 护栏 | `npm run regression` | **0** | `health-api-regression: ok`，四组真实执行 | `regression.txt` |
| 全量 | `npm test -- --runInBand` | **0** | **446/446，19 套件全过**（433 存量 + 12 新增 +1 净迁移） | `full-test.txt` |
| Lint | `npm run lint` | 1 | **11 error/33 warning**（基线 12/34） | `lint.txt` |

Lint 归因：本批**未引入新问题**——family-invite 唯一命中（require-await L20）与基线逐字相同；重写后的 family-auth/index.js、services/family.js 不再产生旧命中，净减 1 error/1 warning。历史台账其余问题未顺手修复。cloudfunctions 不在 lint 目标内（B6 事项，本期未做）。

补丁隔离：`fix.patch` 以临时树重放 B1/B4/B2/B3/A0-1 补丁后的 A0-1 态为基准，含 14 个改动文件 + 1 个新增测试，共 14 个 diff 段，不含任何历史批次内容。已验证在 A0-1 树上 `patch -p1` 干净应用，应用后 15 个文件与工作区逐字一致。

## 5. settings 时区问题（独立限制）

本轮北京中午执行，全量 Jest 全绿，settings.test.js 通过。该用例夹具用 UTC 日期、服务按北京日期过滤，北京 00:00–08:00 仍会失败 2 个；本批未修、未等时段、未掩盖。

## 6. 本地 Mock 与云端待验证边界

- 全部为本地 Jest、存储替身与本地 Mock 回归：不连真实云数据库；
- 待云端验证：三级文档真实读写、云函数 _openid 归属、安全规则、scopes/noticeRules 落库形态、邀请/加入真实链路、撤销实时性；
- 本地 446 全绿不等于云端通过；未做开发者工具编译、真机或双账号验证；云端配置/索引/部署均未触碰。

## 7. 累计未提交改动（截至本轮结束）

已跟踪修改 **14 个**：

- 云端：cloudfunctions/healthApi/index.js、family-service.js、medication-service.js、record-service.js；
- 脚本/服务：scripts/health-api-regression.js、services/family.js；
- 页面：pages/family-sub/family-auth/index.js+wxml+wxss、family-invite/index.js+wxml+wxss；
- 测试：tests/unit/family.test.js、page-data-consistency.test.js。

新增未跟踪 **6 个**：payload-helpers.js、payload-validation.js、family-policy.js、shared-policy.test.js、a0-permission-policy.test.js、**a0-contract-integration.test.js（本轮）**。未跟踪项另含既有 docs 文档与 evidence/。

## 8. 未执行项

A1（1:1 绑定、family_auth 修复、注销连带）、邀请码频控、代录写路径、contactPhone/拨号、二级页权限、Tab 开放、删死页、Node18 升级、全仓 Lint/日期去重、云端操作与部署——均未进行。本轮结束，不进入 A1。
