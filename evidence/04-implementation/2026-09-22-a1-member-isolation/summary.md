# 实施批次 7 · A1 多成员隔离与精准授权 · 摘要

> **修正说明（2026-09-22 A2 收尾批次追加，原文保留为历史记录）**
> 1. 原"剩余风险"第 1 条称加入与重邀交错"结果是可接受态（无越权）"——该表述**未经充分验证即下结论**。A2 收尾批次已实修：事务内重读邀请文档后**核对 inviteCode 与提交码一致**（不一致按 notFound 拒绝），且重邀必发新码（取消同码复用），交错窗口关闭；可控交错测试见 `../2026-09-22-a2-followup/`。
> 2. 原 §1 事务路径的锚点/事务内 doc.get 采用 try-catch 吞异常按"不存在"处理——A2 收尾已改为 `cloud.database({throwOnNotFound:false})` 的明确 `data:null` 语义，基础设施异常不再被吞掉。

- 日期：2026-09-22（13:20–14:10，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 环境：Node v22.23.2 / npm 10.9.8；此前全部改动保留；未切分支、未提交、未清理既有文件、未部署、未升级运行时、未开放家庭 Tab。
- 数据流审查与归属/更新范围说明：`data-flow-review.md`（本目录）。

## 1. 已接入（本批生产改动，8 个文件）

**云端 family-service.js + family-policy.js：**

1. **加入家庭（1:1 + 幂等 + 自绑拒绝）**：
   - 事务外预检：本人已有 active 关系时，绑定他人 → 拒绝"你已绑定一位家人，请先解除原绑定"；同一 owner → **幂等返回、零写入**，不重置已调整权限；该查询同时兜住锚点方案之前的存量随机 id 行。
   - 原子路径（`db.runTransaction` 存在时，即真实云函数）：family_members 采用**确定性锚点文档** `_id='active-'+memberOpenId`（`getMemberAnchorId`），事务内 doc 级读写——同一成员并发加入压到同一把文档锁；邀请文档在事务内**重读复核**状态，两人抢同一邀请码时后写事务触发写锁冲突→SDK 自动重试（默认 3 次）→复核看到 active+他人→拒绝。
   - 回退路径（本地 Mock，无 runTransaction）：先查后写，代码注释明示**不具备并发保障、仅本地测试用**。
   - 自绑拒绝保留（owner 加入自己的邀请）。
2. **重新邀请**：inviteData 显式 `memberOpenId:''`、status pending；**不触碰任何 family_members 行**；成员权限以各自关系行为准，不从最新邀请配置覆盖。
3. **精准改权 updateFamilyAuth**：memberId 必填（`getLimitedString` required）；写入前校验关系行存在、属当前 owner、status=active；缺失/伪造/他人 memberId → 拒绝且**两表零写入**；只 `doc(memberId).update` 目标行，**删除了按 owner 批量改权兜底**；family_auth 仅当 `memberOpenId===目标成员` 时同步 member 展示与权限字段，待加入/他人绑定的邀请配置不被覆盖。
4. **精准撤销 revokeFamilyMember**：memberId 必填；校验归属；**重复撤销幂等返回零写入**；只撤目标关系行；family_auth 仅当确实绑定该成员时重置；删除了旧的"无 memberId 整体撤销"分支。撤销后该成员 accessContext 查 active 为空 → homeFamily 返回未授权空数据（服务端拒绝，非页面隐藏）。
5. **id 回填修正**：getFamilyAuthData 预览分支 memberId 置 ''（原回填 auth._id）；getFamilyData 预览卡 `id:''、bound:false`（原回填 auth._id）。
6. **注销清理经核查无需改动**：clearUserAccount 已按 memberOpenId/ownerOpenId/_openid 分区清理，updateFamilyAuthByMember 只重置 memberOpenId=注销者的他人邀请配置——本批以测试固化该行为。

**客户端（必要适配，未重做 UI）：**

7. `services/family.js`：mapFamilyMember 对 bound=false 卡保留空 id（不合成假 id）；`updateFamilyAuthLocal` 必须携带 memberId 且本地存在对应成员卡才镜像，否则原样返回远端结果（不造卡、不假成功）；`revokeFamilyMemberLocal` 仅按 memberId 精确移除；两函数导出供测试。云端拒绝时 resolveRemote 抛错、镜像不执行（结构保证，测试固化）。
8. family-auth 页：新增 canEdit（有绑定 memberId 才可编辑），saveAuth/revokeAuth 空 memberId 守卫 + 按钮 disabled；family 页 revokeMember 空 id 守卫。邀请页预选策略未改。

## 2. 本地已验证（测试先行：实现前 12 失败 → 实现后全绿）

新增 `tests/unit/a1-member-isolation.test.js` **23 个用例**（存储替身只模拟存取，含 doc 级 update/remove；无任何权限判断复制）：

- O1 关联 M1、M2 两行 active 互不影响；
- 修改 M1 后 M2 行与无关 pending 邀请逐字节不变；
- 撤销 M1 后 M1 homeFamily 空数据、M2 仍可见记录；撤销只重置确实绑定者的 family_auth；
- M1 注销只删本人关系行，M2/O1 数据不动；注销当前绑定者才重置对应 family_auth；
- memberId 缺失/伪造/空串/他人：改权与撤销均拒绝且**两表零写入**（快照对比）；
- 同 owner 重复加入：不增行、已调整权限不被邀请配置重置；
- 已绑 O1 加入 O2：拒绝、零新行、O2 邀请保持 pending；
- 重邀清空 memberOpenId、保留 M1 关系行原样；
- 自绑拒绝；同码顺序竞争后到者拒绝；被撤成员可经新邀请复活（锚点/旧行更新为新关系）；
- 预览分支不回填 auth id（getFamilyAuthData/getFamilyData）；
- 客户端镜像三用例（无 memberId 不镜像、精确更新单卡、精确移除单卡）。

| 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|
| 实现前目标测试 | 1 | **12 失败/11 通过**（23 总） | `before.txt` |
| 实现后目标测试 | **0** | **23/23** | `after.txt` |
| 相关套件（A0 集成/共享/家庭/规则） | **0** | 115/115 | `related-tests.txt` |
| `npm run regression` | **0** | ok，B1 四组真实执行 | `regression.txt` |
| 全量 `npm test -- --runInBand` | **0** | **475/475，20 套件全过**（452 + 23 新增） | `full-test.txt` |
| `npm run lint` | 1 | 11 error/33 warning，family 页命中与 A0-2 时点逐行一致，**零新增** | `lint.txt` |

A0-2 集成测试两处按 A1 新契约迁移（同步断言种子补 memberOpenId；入口拒绝用例补有效 memberId 并加零写入断言；装配修正 getLimitedString 来源）——属契约迁移，未删用例、未放宽预期。

补丁：`fix.patch` 以重放全部历史补丁（B1→B4→B2→B3→A0-1→A0-2→收尾）的基线树为基准，8 段；已验证干净应用且 8 个文件与工作区逐字一致。

## 3. 云端待验证（部署后测试环境实测，本批未操作云端）

1. **R1 同一成员并发加入两个家庭**：锚点文档事务锁 + 重试的实际行为（含冲突超限报错路径）；
2. **R2 两人抢同一邀请码**：事务写锁冲突→重试→复核拒绝的真实时序；
3. `transaction.doc().get()` 对不存在文档的行为（代码按 throw→null 兼容处理，需实测 throwOnNotFound 配置组合）；
4. 锚点行 `set` 时 `_openid` 的平台写入规则（decisions 4.5 既有验证点，relationData 已显式携带 _openid）；
5. runTransaction 在 wx-server-sdk 2.6.3 真实云环境的可用性（本地 SDK 源码核对通过，未连云）。

**部署前置条件**：wx-server-sdk ≥2.6.3（已满足）；无新集合、无新索引、无 backfill（decisions 第 7 项：线上无真实家庭数据；存量随机 id 行由事务外 where 预检兜住）。

## 4. 剩余风险（如实列出）

- **快照隔离边界**：事务保障来自单文档写锁；跨文档的 write skew（如"加入"与"owner 同时重邀"交错）不在锁范围内——重邀只写 family_auth、加入在事务内重读该文档，窗口极小但理论上存在"加入瞬间重邀"的交错，结果是成员按旧邀请配置绑定、新邀请 pending，属可接受态（无越权），A5 撤销实时生效会进一步收敛。
- **旧客户端缓存**：撤销/改权后，旧客户端已缓存数据与在途请求**未验证已失效**——缓存清理与 stale TTL 归 A5，本批不宣称。
- Mock 无并发能力：所有并发结论以第 3 节云端实测为准，本地测试只证明判定逻辑与写入范围。
- settings 时区台账仍在（本轮北京下午执行全绿；凌晨 00:00–08:00 该套件会失败 2 个，未等待、未掩盖）。
- lint 的 11 error/33 warning 为历史台账（检查范围 services/utils/pages/components，cloudfunctions 不在内，B6 未实施）。

## 5. 未执行项

A2 频控与邀请错误态、A3 二级页家属态、A4 代录写路径、A5 缓存治理、A6 电话提醒、A7 Tab 开放/删死页、Node18、云端配置/索引/部署、全仓日期去重与 Lint 清理——均未进行。未新增业务决策；锚点 _id 约定与事务用法属 decisions 已委托的实现机制。

## 6. 累计未提交改动（截至本轮结束）

已跟踪修改 15 个（新增 pages/family/index.js）；新增未跟踪 7 个（新增 tests/unit/a1-member-isolation.test.js）；其余同 A0-2 收尾时点。本批结束，不进入 A2。
