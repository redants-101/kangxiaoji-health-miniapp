# 联调前核验 · 云端与本地版本对照

- 核验时间：2026-09-22（16:50–17:10，UTC+8），全部为**只读**查询（tcb fn detail / list-function-versions / get-route、db nosql listIndexes/count、DescribeDatabaseACL、env list）；未部署、未改云端数据/索引/规则/流量。
- 凭据卫生：本文档不含凭据、完整 openId、邀请码或健康数据。

## 1. 环境

| 项 | 云端实际（本轮实测） | 本地配置 | 一致性 |
|---|---|---|---|
| envId | `kangxiaoji-d5gw2k203f0488a9e`（账号下**唯一**环境，个人版，Normal，ap-shanghai） | cloudbaserc.json 同值 | ✅ |
| 独立测试环境 | **不存在**（env list 仅 1 个） | — | ⚠️ 见 user-confirmations |

> 措辞更正：此前文档把该环境称作"测试环境"不严谨——它是账号下唯一环境，**是否承载已发布小程序无法从 CLI 确认**，列入部署前用户确认事项。

## 2. healthApi 函数

| 项 | 云端实际 | 说明 |
|---|---|---|
| $LATEST 状态 | Deployment completed | 2026-09-22 **15:28:01** 部署（A2 批次版本） |
| 运行时/内存/超时 | Nodejs16.13 / 256MB / 60s | 与 cloudbaserc.json 一致；未升级（A-1 独立阶段） |
| 代码体积 | 11,167,183 B | |
| 流量路由 | get-route 返回空表 → **100% $LATEST**，无版本分流 | |
| 回滚版本 | **版本 1 `backup-before-a0a1a2-deploy`**（2026-09-22 15:27:16，Deployment completed） | A0/A1/A2 之前的旧代码快照，可用 |

**版本落差**：云端 $LATEST = A2 部署版；本地工作区 = A2 + 收尾批次 + 本次 preflight 修正。云端函数包内的实际差异文件为 **2 个**：`family-service.js`（noInvite 态、事务码重验、有效期边界、原子频控、add-catch 签名判别）与 `index.js`（`cloud.database({throwOnNotFound:false})`）。前端（services/pages）差异不在函数包内，需另行上传小程序版本才生效。

## 3. 数据库（只读实测）

| 集合 | 索引 | ACL | 数据量 |
|---|---|---|---|
| family_invite_attempts | `_id_`、`createdAt_ttl`（expireAfterSeconds=86400，前批已验证） | ADMINONLY | **0 条**（空，新旧计数形态无共存冲突） |
| family_auth | `_id_`、`_openid_1`、`familyId`、`inviteCode_unique(unique,sparse)` | ADMINONLY | 13 条历史测试文档（11 条 pending 带码、2 条已清码字段；是否清理待用户决定） |
| family_members | （未列索引，本轮未查）| ADMINONLY | 0 条 |

与 console-operations.md 记录一致，无漂移。

## 4. 部署前置条件核对结果

| 条件 | 状态 |
|---|---|
| 集合 family_invite_attempts | ✅ 已建 |
| TTL 索引 24h | ✅ 已建 |
| inviteCode sparse 唯一索引 | ✅ 已建 |
| 三集合安全规则仅云函数读写 | ✅ 均 ADMINONLY |
| 回滚点 | ✅ 版本 1 可用；**建议部署前对当前 $LATEST 再发一个版本快照**（见 rollback-steps） |
| wx-server-sdk 版本 | ✅ 2.6.3（≥1.7.0，支持 throwOnNotFound 配置与 runTransaction） |
