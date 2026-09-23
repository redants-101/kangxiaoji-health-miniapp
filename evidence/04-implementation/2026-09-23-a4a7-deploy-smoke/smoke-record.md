# 部署后冒烟记录 — 2026-09-23 10:55–11:05

身份：全部为**合成冒烟身份**（非真实 openid）：`smoke-join-0923`（邀请码状态）、`smoke-nb-0923a`（无绑定）、`smoke-member-a6`/`smoke-owner-a6`（A6 合成关系）。数据：全部合成；电话号码为合成占位号（记录中一律脱敏 138****0000）。原始输出：smoke-s1-s3.txt / smoke-s4.txt / smoke-s5.txt / smoke-s6.txt / smoke-s7.txt / smoke-s8.txt / smoke-s9-s10.txt。

## 结果（10/10 通过）

| # | 项 | 调用 | 实际返回 | 判定 |
|---|---|---|---|---|
| S1 | 缺邀请码 → noInvite | key familyJoin payload={} | `noInvite:true`，scopes[]，无默认有效邀请 | ✓ |
| S2 | 非法码 | inviteCode=BADCODE | `inviteError.code=FAMILY_INVITE_INVALID` | ✓ |
| S3 | 格式对但不存在 | KXJ000000000（合成） | `FAMILY_INVITE_NOT_FOUND` | ✓ |
| S4 | 过期码 | 合成过期文档 KXJSMOKEEXP1 | `FAMILY_INVITE_EXPIRED` | ✓ |
| S5 | 无绑定 familyView | key recordList {familyView:true} + key homeFamily | `{familyView:{allowed:false,reason:noBinding}}`；homeFamily 未授权空数据（readPermissions 全 false、phoneReminder 全关），无健康数据 | ✓ |
| S6 | A3 路由无 TypeError | key trend/medList/medHistory {familyView:true} | 三条均干净返回 noBinding 拒绝；无 errMsg/TypeError（修复前此路由线上抛错） | ✓ |
| S7 | 未授权代录拒绝+零写入 | action familyRecordBloodPressure | `{familyWrite:{allowed:false,reason:noBinding}}`；health_records count(createdByMemberOpenId=smoke-nb-0923a)=**0** | ✓ |
| S8 | remind=false 不回号码 | 合成 active 关系（read×3=true，remind 全 false）+ owner 合成号码文档；key homeFamily + action familyGetReminderPhone | homeFamily：`phoneReminder{remindAllowed:false,configured:false,canCall:false,masked:''}`，readPermissions 与 scopes 一致；取号：`{phoneDenied:{allowed:false,reason:remindDenied}}`；两次响应 grep 完整号码=**0 命中**（完整/脱敏均未回传） | ✓ |
| S9 | A7 配置缺失保守回退 | key appConfig（app_configs 集合未创建） | `{familyTabEnabled:null}` → 端侧按 envVersion 默认（正式版关/体验版开） | ✓ |
| S10 | 家庭 Tab 关闭不加载家庭数据 | key family（无绑定合成身份） | 空态 `{familyCount:0,members:[],inviteCode:''}`，无泄露。**口径说明**：开关关闭时"不加载"是客户端行为（A7 本地测试 14/14 固化）；云端冒烟证明的是无绑定/空态下 family 路由本身零数据。真机占位态见双手机手册 A7-T 组 | ✓（按口径） |

S8 同时构成"A3 家属读取路由对真实 active 关系正常工作"的运行时证明（getHomeFamilyData 走 record/plan 查询与 A6 字段计算，无装配错误）。

## 冒烟写入登记（用途/类型/ID/清理条件/结果）

| 文档 | 集合 | _id | 用途 | 清理条件 | 结果 |
|---|---|---|---|---|---|
| 频控计数 | family_invite_attempts | `invite-fail-smoke-join-0923-2026-09-23`（count=3，S2/S3/S4 产生） | 邀请错误码冒烟的副产品 | 冒烟结束即删 | 已删 n=1，复核 0 |
| 过期邀请 | family_auth | `smoke-a4a7-expired-auth`（inviteCode=KXJSMOKEEXP1，expiresAt=2026-09-22T00:00Z） | S4 过期态 | 冒烟结束即删 | 已删 n=1，复核 0 |
| A6 owner 配置 | family_auth | `smoke-a4a7-a6-auth`（contactPhone=合成号 138****0000） | S8 号码不回传验证 | 冒烟结束即删 | 已删 n=1，复核 0 |
| A6 合成关系 | family_members | `smoke-a4a7-a6-member`（smoke-member-a6 ↔ smoke-owner-a6，active，remind 全 false） | S8 | 冒烟结束即删 | 已删 n=1，复核 0 |

只读调用（S1、S5–S7、S9、S10）零写入。历史 family_auth / family_members / attempts 数据未删除、未修改（删除均按上表精确 _id，limit 1）。
