# A2 收尾 · 频控并发控制方案（先方案后实现）

- 日期：2026-09-22
- 已确认口径：**北京自然日、每调用者最多记录 20 次失败，之后拒绝；查询与 join 共用额度**；TTL 仅负责物理清理，不承担日界与额度正确性。

## 1. 现方案缺陷（复现）

当前实现是"先 count 后 add"（countTodayInviteFailures → recordInviteFailure），两步之间无原子性：N 个并发请求可同时通过 count<20 的门限，再各自探测邀请码并各自写入——上限被并发突破，且探测（真正的枚举动作）发生在门限之后不受额度约束。

## 2. 能力核对（来源记录）

| 能力 | 结论 | 来源 |
|---|---|---|
| 条件更新操作符 `_.lt` / `_.gt` | 支持 | 实际部署的 wx-server-sdk 2.6.3 内置 @cloudbase/database：`dist/commonjs/command.js` L15 `lt(val)`、`gt`；查询序列化器 `commands/query.js` |
| 更新指令 `_.inc` | 支持 | 同上 `command.js` L83 `inc(val)` |
| `where(cond).update()` 返回命中数 | 支持，返回 `{updated}` | 同上 `query.js` L146-L172（`updated: res.data.updated`） |
| `add` 携带自定义 `_id` | 支持（数据原样序列化提交，重复 _id 由服务端唯一性拒绝） | 同上 `collection.js` L26-L45（database.insertDocument，data 原样 EJSON 序列化） |
| 单文档写原子性 + 乐观锁模式 | **单文档写操作原子；filter 带期望值 + `$inc` 即官方推荐的并发防护模式** | MongoDB 官方手册 Atomicity and Transactions："write operations are atomic on the single-document level"；并发防护给出 filter-with-expected-value 与 `$inc` 两模式（https://www.mongodb.com/docs/manual/core/write-operations-atomicity/ ，本轮已抓取核对） |
| 事务内 doc.get 不存在文档 | `cloud.database({throwOnNotFound:false})` 时明确返回 `{data:null}`；否则抛 "document with _id … does not exist" | wx-server-sdk 2.6.3 打包源码 index.js L1272-L1290、Database(config) L1015-L1030 |
| runTransaction 冲突自动重试/快照隔离 | 默认重试 3 次；仅单记录操作 | 微信云开发官方文档（前批已检索记录）+ SDK transaction 源码 |

结论：**无需 runTransaction、无需新索引**，用"确定性 _id 计数文档 + 条件更新（CAS）"即可获得原子额度控制；`_id` 天然唯一即并发防线。

## 3. 方案：预留额度式原子计数（reserve-and-refund）

**数据结构**（family_invite_attempts，集合已建、TTL 已建、当前为空，无迁移负担）：

- 每 (openId, 北京日) 一个计数文档：`_id = 'invite-fail-' + openId + '-' + day`，字段 `{_id, openId, day, count, createdAt, updatedAt}`；不含邀请码明文。
- 日界正确性由 key 内嵌 `day`（北京日期串）保证；TTL(24h, createdAt) 只负责物理清理过期计数文档。

**预留（原子门限）**——每次带码查询/加入前执行：

```
cond-update: where({_id:key, count: _.lt(20)}).update({count: _.inc(1)})
  updated=1 → 预留成功（额度已原子占用）
  updated=0 → 查文档：
    存在（count≥20）→ 拒绝 RATE_LIMITED（不探测邀请、不计数）
    不存在 → add({_id:key, count:1, ...})
      add 成功 → 预留成功
      add 撞 _id 重复（并发建文档）→ 回到 cond-update 重试一次；仍失败 → 保守拒绝
```

单文档条件更新原子 ⇒ **并发请求不可能全部先通过门限再各自探测**：第 21 个并发请求的 cond-update 命中 count=20 不满足 `lt(20)`，updated=0 → 拒绝。

**核销与退还（四类结局区分）**：

| 结局 | 额度处理 |
|---|---|
| 邀请失败（格式/不存在/缺失 expiresAt/过期/撤销/已被使用） | 预留即计数，不退还 |
| 查询/加入成功 | 退还：`where({_id:key, count:_.gt(0)}).update({count:_.inc(-1)})` |
| 业务性拒绝但非枚举失败（自绑 SELF、已绑定他人 BOUND、幂等重复加入） | 退还（不占失败额度） |
| 基础设施异常（探测查询抛错、事务冲突重试耗尽等） | 退还后原样抛出（不把基础设施故障计成用户失败）；退还自身失败仅使额度偏紧（fail-closed），不放宽 |

事务重试：runTransaction 冲突自动重试发生在同一次预留之内，只计 1 次额度。

**不静默降级**：本方案只依赖 where/update/add 基础能力（云端与本地 Mock 同一代码路径，Mock 需实现 lt/gt/inc 的存储语义——属存储引擎行为模拟，非业务判断复制）。不存在"生产缺能力时退回不受保护路径"的分支。

**部署条件**：无新集合、无新索引（_id 即唯一约束）；需要重新部署 healthApi 云函数（本批不部署）。

## 4. 本地可证明 vs 需测试环境验证（分开报告口径）

- 本地可证明：控制流（updated 计数 → 分支）、计数/退还/日界/按调用者隔离、文档不含码、并发 add 撞 _id 后的重试路径（用抛重复错的 Mock 触发）。
- 需测试环境验证：真实并发交错下 cond-update 的串行化效果（压测同 openId 并发 21+ 请求，断言成功预留恰 20）；TTL 实际删除时点。

## 5. 其余三项修正方案（同批实施）

1. **无邀请码态**：getFamilyJoinData 缺码返回 `noInvite:true` 说明态（title"尚未获得邀请"、remainHours=0、scopes=[]、无有效标志）；空串/纯空白同缺码；**非字符串真值 → INVALID 且计数**（不得冒充缺码）；页面隐藏"邀请有效"徽标、禁用加入按钮、joinFamily 守卫；本地镜像 join 无码时同样拒绝不假成功。
2. **重邀/加入交错**：事务内重读邀请文档后**核对 inviteCode 与提交码一致**，不一致按 notFound 拒绝（旧码请求不消耗新邀请）；同时复核 status/有效期/owner。事务 doc.get 改走 `cloud.database({throwOnNotFound:false})` 的明确 `data:null` 语义（index.js 一处改动），**删除吞异常的 try/catch**——不存在=确认的 data:null，网络/权限/冲突异常直接上抛。generateUniqueInviteCode 取消"命中自己旧码可复用"豁免：重邀必发新码（否则旧码在重邀后仍有效，正是交错攻击面）。daily-stats 两处 doc.get 未命中时行为不变（仍空统计回退），仅日志分类由 error 桶变 ok 桶。
3. **有效期边界**：classifyInviteAuth 增加——expiresAt 不可解析（NaN）→ INVALID；`expiry <= now`（刚好到期）→ EXPIRED；成功路径 remainHours 必为有限正数。
