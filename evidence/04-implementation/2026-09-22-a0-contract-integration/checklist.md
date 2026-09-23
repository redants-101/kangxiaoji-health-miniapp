# A0-2 接入清单：三级权限契约接入现有家庭调用链

- 日期：2026-09-22
- 依据：decisions.md、A0-1 summary 及三项已确认语义（write 需 read+write；read=false/remind=true 仅出电话按钮；提醒明细 = read+remind+noticeRules 合取）

## 1. 统一契约（接口/存储/页面）

**存储与云端接口（canonical）**：

- `scopes`：数组，恰好四项，固定顺序
  `{key, title, meta, read:<bool>, write:<bool>, remind:<bool>}`，key ∈ bloodPressure/bloodGlucose/medicine/report；
- `noticeRules`：**对象** `{missedMedicine:<bool>, missingRecord:<bool>, weeklyReport:<bool>}`，不再是旧数组；
- `member`：成员对象（含关系名称等展示字段）。

**页面展示形态（经显式转换，不静默丢失设置）**：

- scopes 数组直接渲染，每块三个开关（read 查看 / write 代录 / remind 提醒）；report 不渲染 write 开关；
- noticeRules 在授权页用 `noticeRulesToList` 转列表（含 title/meta/checked）；保存前用 `noticeRulesFromList` 转回对象，严格布尔。
- 转换函数只放在小程序可打包的 `services/`（前端）与云端 `family-policy.js`（云端），两侧互不跨目录引用；转换是展示适配，授权判定只在云端规则函数。

## 2. 逐入口接入表

| 入口（route/action） | 数据结构 | 调用的规则 | 持久化 | 返回 | 客户端消费 | 测试 |
|---|---|---|---|---|---|---|
| key `familyInvite` | relations 8 项；scopes 默认态 | `FAMILY_RELATIONS_V2`、`getDefaultInviteScopesV2` | 无 | 关系+scopes+预览 | family-invite 页 | 集成 1 |
| action `createFamilyInvite` | selectedRelation、scopes[] | `normalizeFamilyInvitePayloadV2`（关系未知拒绝；scopes 走 V2 校验） | family_auth upsert | inviteCode/预览 | family-invite | 集成 1、非法关系 |
| key `familyJoin` | inviteCode | auth 读取 + 状态/有效期判断 | 无 | scopes 仅 read 项、身份 | family-join 页（只读展示） | 集成 |
| action `joinFamilyByInvite` | inviteCode | code 校验；scopes/noticeRules 归一化 | family_auth 更新 + family_members upsert | status active | family-join→homeFamily | 集成 2 |
| key `homeFamily` | — | `getFamilyAccessContext` + `canViewScope` 四块 | 无 | 受控记录/用药/周报，关闭块**响应中不含明细** | home-family 页 | 集成 3/4/5（核心） |
| key `familyAuth` | memberId | scopes/noticeRules 归一化回显 | 无 | scopes V2 + noticeRules 对象 | 经 services 转 noticeRules 列表 | 集成、family.test |
| action `updateFamilyAuth` | member、scopes、noticeRules(list→object)、activities | `normalizeFamilyAuthPayloadV2`（report.write/非布尔/未知/重复在入口拒绝） | family_auth + family_members 同步 | 写入结果 | family-auth 页 | 集成 6 |
| action `revokeFamilyMember` | memberId | 归属校验 | status revoked | — | family-auth | 既有覆盖 |

## 3. 默认值口径（UI 初始态，owner 可改；非"缺字段默认放权"）

- 邀请页 scopes 初始：四块 **read=true、remind=true、write=false**（代录须显式打开）；report 无 write。
- 邀请默认 noticeRules：`{missedMedicine:true, missingRecord:false, weeklyReport:true}`（沿用旧默认意图）。
- 归一化时字段缺失一律 false（最小授权），与上述"页面初始勾选"是两件事。
- write 开关不联动 read；云端在 read 缺失时拒绝动作。

## 4. 文件级改动

云端：

- `family-policy.js`：新增 getScopeTextV2、两个邀请默认工厂、两个 PayloadV2 归一化；删除旧 enabled 六函数；access context 回落项改 V2。
- `family-service.js`：全部方法改注入 V2 依赖，无规则复制。
- `index.js`：family-service 装配键更新。
- `scripts/health-api-regression.js`：family 用例注入同步更新（B1/B4 内容保留）。

前端：

- `services/family.js`：关系目录 8 项、getScopeText 按 read、noticeRules 双向转换、本地镜像 V2。
- family-invite 页 js+wxml：三开关；family-auth 页 js+wxml：三开关 + noticeRules 列表 checked；family-join wxml 无需改（字段兼容）。

测试：

- 新增 `tests/unit/a0-contract-integration.test.js`（先失败）。
- 迁移 `tests/unit/family.test.js`、`tests/unit/shared-policy.test.js` 旧契约组，不删用例不跳过。

## 5. 明确保留的非权限 `.enabled`（本批不改）

services/settings.js（本地确认分组）、settings-data-service 提醒项、medication-plan 服务与 med-edit 页（计划开关）、sendDueReminders。

## 6. 阻塞评估：无新增业务决策冲突

三项语义已在 A0-1 前确认；清单内其余项均可按已确认决策实施。
