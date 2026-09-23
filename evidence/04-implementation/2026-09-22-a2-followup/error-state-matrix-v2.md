# A2 错误码与页面状态矩阵（收尾修订版 v2）

> 替代 `../2026-09-22-a2-invite-security/error-state-matrix.md`（原件保留为历史）。
> 修订点：新增无邀请码说明态；频控机制改为原子预留额度；有效期边界口径补全；重邀必发新码。

- 契约单点定义：`cloudfunctions/healthApi/family-policy.js`（FAMILY_INVITE_ERRORS、INVITE_CODE_PATTERN、INVITE_FAILURE_LIMIT_PER_DAY=20）
- 查询链路：key `familyJoin` 返回体 `noInvite` / `inviteError:{code,message}`；动作链路：main 出口 `{errMsg, errCode}` → `services/core.js buildCloudError` → `error.code`
- 页面消费：`pages/family-sub/family-join`（INVITE_ERROR_TITLES 字面量码表 + noInvite 分支）

| # | 触发条件 | 返回形态 | 页面状态 | join 动作行为 | 频控额度 | 截图 |
|---|---|---|---|---|---|---|
| 1 | 加载中 | — | isLoading 面板 | — | — | A2-S01 |
| 2 | **未携带邀请码**（undefined/null/空串/纯空白） | `noInvite:true`，remainHours=0、scopes=[]、**无"邀请有效"标志** | 说明态"尚未获得邀请，请通过家人分享的邀请进入"；**加入按钮不渲染** | 本地/云端均拒绝（NOT_FOUND），不假成功 | 不占额度 | 无需截图（说明态可由无码直开触发） |
| 3 | 有效 pending 邀请 | 预览（scopes 仅 read 项，remainHours≥1 有限值） | 正常预览 + "邀请有效 · 剩余 N 小时" | 成功 → active → 家属首页 | 预留后退还 | A2-S02 |
| 4 | 非字符串真值（数字/对象/布尔/数组） | `inviteError: INVALID` | "邀请码无效" | validateInviteCodePayload 抛"邀请码不能为空" | **占额度** | 与 S03 同态 |
| 5 | 格式非 `KXJ[0-9A-Z]{9}` | INVALID | "邀请码无效" | 抛错 code=INVALID | 占额度 | A2-S03 |
| 6 | 格式正确但不存在 | NOT_FOUND | "邀请不存在" | 抛错 | 占额度 | A2-S03（同态） |
| 7 | expiresAt 缺失 **或不可解析**（NaN） | INVALID | "邀请码无效" | 抛错 | 占额度 | 待测试环境触发 |
| 8 | 已过期（含**刚好到期 ts<=now**） | EXPIRED | "邀请已过期" | 抛错 | 占额度 | A2-S04 |
| 9 | status=revoked | REVOKED | "邀请已撤销" | 抛错 | 占额度 | A2-S05 |
| 10 | status=active 且绑定他人 | USED | "邀请已被使用" | 抛错 | 占额度 | A2-S06 |
| 11 | 当日额度已满（计数文档 count≥20，北京日界） | RATE_LIMITED | "尝试过于频繁" | 抛错（与查询共用额度，防绕过） | 拒绝不占 | A2-S07 |
| 12 | 加入自己的邀请 | （查询态不判） | — | 抛错 SELF | 退还 | 不在清单 |
| 13 | 已绑定另一位老人（A1） | （查询态不判） | — | 抛错 BOUND | 退还 | 不在清单 |
| 14 | 网络失败/云函数异常 | loadError（查询）；toast+刷新（join） | "加入信息加载失败"+重试 | toast 文案 | 基础设施异常退还额度 | 不在清单（既有能力） |
| 15 | 事务内发现邀请已被重邀换码（交错） | — | —（join 时发生） | 抛错 NOT_FOUND，新邀请不被消耗 | 占额度 | 无法界面触发（并发窗口） |

## 频控机制（v2，原子预留）

- 计数结构：family_invite_attempts 每 (openId, 北京日) 一条计数文档 `_id='invite-fail-<openId>-<day>'`，字段 `{openId, day, count, createdAt, updatedAt}`，**不含邀请码明文**。
- 门限语义：先原子预留额度（`where({_id, count:_.lt(20)}).update(_.inc(1))`，单文档条件更新原子性），预留成功才探测邀请；失败保留额度、成功/自绑/已绑定/基础设施异常退还。**并发请求不可能全部先过门限再各自探测**。
- 日界由 key 内嵌 day 保证；TTL(24h) 仅物理清理。
- 本地 Mock 证明控制流与计数口径；真实并发串行化效果属测试环境待验证（压测项，见联调清单）。

## 失败路径不变式（测试固化）

任何错误态（含频控拒绝、交错拒绝）：family_members 零写入、family_auth 不变 active、重邀必发新码（旧码即刻失效）。
