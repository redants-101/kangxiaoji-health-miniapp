# A1 数据流审查：数据归属与更新范围说明

- 日期：2026-09-22（13:20 起，UTC+8）
- 依据：decisions.md（第 2 项 1:1、4.2 节 A1 四项修复）、A0-2 与收尾修正证据
- 方法：通读 family-service.js、family-policy.js、settings-data-service.js 注销链路、family/family-auth 页面与 services/family.js 本地镜像；官方事务能力经微信云开发文档与已安装 wx-server-sdk 2.6.3 源码双重核对。

## 1. 现状数据归属

| 集合/文档 | 归属 | 语义 |
|---|---|---|
| family_members 行 | `ownerOpenId`（业务字段）+ `_openid`（平台写入=加入者本人） | 一位成员对一位老人的**关系行**；成员级 scopes/noticeRules 以此为准（decisions 4.2） |
| family_auth 单文档 | `_openid` = owner | owner 的**当前邀请/预览配置**载体，非成员权限来源 |
| profiles/records/... | `_openid` = 本人 | 与 A1 无关 |

## 2. 现状问题（A0-2 后仍存在）

1. **joinFamilyByInvite 无 1:1 拦截**：同一 memberOpenId 可先后加入多位老人，family_members 出现多行 active。
2. **重复加入不幂等**：existing 查询命中后**无条件 update**，会用邀请配置覆盖已调整的权限（decisions 4.2 明确要求幂等放行）。
3. **重新邀请残留绑定**：createFamilyInvite 的 inviteData 不含 `memberOpenId`，更新旧文档时上一位成员的 memberOpenId 残留，status 虽置 pending 但绑定字段未清（decisions 4.2 要求显式清空）。
4. **updateFamilyAuth 批量兜底**：memberId 缺失时按 `{ownerOpenId, status:'active'}` **批量更新所有 active 关系**，且 family_auth 无条件被成员数据覆盖——改一个成员会污染其他成员和正在进行的邀请（decisions 4.2 要求 memberId 必填、只更新目标）。
5. **revokeFamilyMember 无 memberId 分支**：缺失时直接撤销 family_auth 当前文档，对多成员场景是误伤面。
6. **注销链路经核查已正确**：clearUserAccount 删除本人 profiles/records/计划/确认/提醒/隐私/反馈/统计；family_members 按 `memberOpenId=本人`（作为家属）与 `ownerOpenId=本人`（作为 owner）两个不相交 where 分区删除；family_auth 按 `_openid=本人` 删除本人邀请配置；`updateFamilyAuthByMember` 只重置 `memberOpenId=本人` 的**他人** family_auth（正是"当前邀请确实对应注销者"的情形）。owner 注销删除自己名下全部关系行属 decisions 4.2 认可的清理范围（owner 数据整体删除，关系失去意义）。**本项无需改动**，补测试固化。

## 3. 竞争分析与原子保障方案

### 3.1 两类竞争

- **R1 同一 member 并发加入两个家庭**（含双击重试）：先查后写下两个请求都查不到 active 行 → 双双写入 → 1:1 破坏。
- **R2 两名成员抢同一邀请码**：都读到 status=pending → 都绑定 → family_auth 只有一个 memberOpenId，后写覆盖先写，family_members 出现两行指向同一 owner 的"被邀请人"。

### 3.2 官方能力核对（已查证，非臆断）

微信云数据库 `db.runTransaction`（仅云函数端，wx-server-sdk ≥1.7 提供，本仓已装 2.6.3）：

- 事务内**只允许单记录操作** `collection.doc()` / `collection.add()`，不支持 where 批量（避免大锁）；
- 可跨集合、可多记录；写对象加**事务锁**：其他事务写同一对象直接失败，普通 update 阻塞至锁释放；
- **快照隔离，非串行化**：无写写冲突的并发事务（write skew）不会互相回滚——纯"先查后写"即使放进事务也不解决 R1/R2；
- 冲突自动重试（默认 3 次），超限报错；回调可能执行多次，须幂等、不得含不可重复副作用。

结论：R1/R2 的保障必须落在**确定性单文档**上，让并发写落在同一把事务锁上。

### 3.3 方案：确定性锚点文档 + 事务

family_members 中为每位成员维护**确定性 _id 的锚点行**：`_id = 'active-' + memberOpenId`（同一成员全局唯一，天然把 R1 的两个并发写压到同一文档锁上）。加入流程：

1. 事务外预检：邀请码有效性、owner 身份、本人已有 active 关系（where 查询，兼容存量随机 id 行）——命中他人绑定→拒绝；命中同 owner→幂等返回零写入；
2. 事务内：`doc(anchorId).get()`（不存在按 null 处理）→ active 且属他人→拒绝；active 且同 owner→幂等返回；否则 `set/update` 锚点行为新关系数据；
3. 同事务内重读邀请文档 `doc(authId).get()` 复核状态（pending/active-本人/未过期），再 update 邀请为 active+memberOpenId——R2 的第二个事务在写邀请文档时触发事务锁冲突→自动重试→重读看到 active+他人→抛"邀请已被其他家属使用"。

**部署前置条件**：wx-server-sdk ≥2.6.3（已满足）；无新集合、无新索引、无数据迁移（decisions 第 7 项：线上无真实家庭数据，存量随机 id 行不做 backfill，由事务外 where 预检兜住）。事务回调内无消息推送等不可重复副作用。

**回退路径**：`db.runTransaction` 不存在（本地 Mock）时走"预检+先查后写"，**仅用于本地测试**；代码注释与 summary 明示其不具备并发保障，不得当作已验证的原子性。

### 3.4 Mock 的边界（如实声明）

本地 Mock 无锁、无快照、无重试，能验证的是**判定逻辑与写入范围**（谁被拒、谁被写、写了什么），不能验证锁冲突、重试与提交原子性。R1/R2 的原子保障列为**云端待验证项**（部署后需在测试环境实测并发加入与抢码）。

## 4. 各入口的目标更新范围（本批实施口径）

| 入口 | 校验（写入前） | 允许写入 | 禁止触碰 |
|---|---|---|---|
| joinFamilyByInvite | 邀请有效；非自绑；本人无他人 active 绑定 | 本人锚点行（新建/复活）；该邀请文档（active+memberOpenId） | 其他成员关系行；其他 owner 的任何文档 |
| 同 owner 重复加入 | 本人已有同 owner active 行 | **零写入**（幂等返回现状） | 已调整的关系行权限 |
| createFamilyInvite（重邀） | owner 身份 | family_auth 单文档：新邀请码、**memberOpenId 清空**、status=pending | family_members 任何行（成员权限以关系行为准） |
| updateFamilyAuth | memberId 必填；关系行存在、属当前 owner、status=active | 目标关系行（member/scopes/noticeRules/activities）；family_auth **仅当**其 memberOpenId=目标成员时同步 member 展示与权限字段 | 其他关系行；memberId 非法时两张表零写入；邀请中的 family_auth（memberOpenId 不匹配）不被覆盖 |
| revokeFamilyMember | memberId 必填；关系行存在且属当前 owner | 目标关系行 status=revoked；family_auth 仅当 memberOpenId=目标成员且 active 时重置 | 其他关系行；重复撤销零写入（幂等返回）；无关邀请配置 |
| clearUserAccount | confirm | 既有分区清理（见 §2.6，不改动） | 他人数据 |

## 5. 客户端 memberId 核查结论

- family 页成员卡 `data-id="{{item.id}}"`：关系分支 id=relation._id（正确）；**owner 预览分支 id=auth._id（错误来源）**——预览卡不是关系行，拿它去改权/撤销会被新服务端拒绝，但应在源头置空并禁止操作。
- family-auth 页：`options.id` 传入 memberId；无 id 时加载的是邀请配置预览，**不得**提交改权/撤销（saveAuth/revokeAuth 需守卫），云端 getFamilyAuthData 预览分支不得回填 auth._id 充当 memberId。
- services/family.js 本地镜像：`updateFamilyAuthLocal` 在 payload 无 memberId 时**自造** `createRecordId('member')` 假 id 并可能新建成员卡——必须收紧为仅按服务端确认的 memberId 精确更新，找不到对应成员卡则跳过镜像（等下次拉取刷新），不造卡、不假成功。云端拒绝时 resolveRemote 抛错、镜像不执行（结构上已满足，补测试固化）。
- 本地镜像/缓存不作为授权依据：镜像仅离线回显；enforceHomeFamilyAccess 只做 revoked 空态展示，无放行分支（现状已满足，不改）。

## 6. 无需新增业务决策的确认

本批全部动作可由 decisions.md 第 2/7 项与 4.2 节直接推出；锚点 _id 约定与事务用法属实现机制（决策已委托实施方），不涉及新授权语义。邀请页预选策略、Tab、A2-A7 均不触碰。
