# healthApi 收尾版部署记录（用户授权执行）

- 授权：用户 2026-09-22 明确授权部署收尾版至唯一环境、仅 healthApi；其消息中"环境使用情况"模板占位未填写，已如实记录（家庭 Tab 未开放、family_members 实测 0 条，风险面收敛，按保留的授权语句执行）。
- 环境：`kangxiaoji-d5gw2k203f0488a9e`（账号唯一环境）。

## 时间线（UTC+8）

| 时间 | 动作 | 结果 |
|---|---|---|
| 18:45:58 | 部署前核对：3 个未跟踪共享模块在包内（family-policy 15938B / payload-helpers 4982B / payload-validation 4852B）；family-service/index 语法通过；regression ok；路由空表（100% $LATEST）；版本列表 = $LATEST(15:28 A2 版) + v1 | ✅ |
| 18:46:47 | 发布回滚快照 | **版本 2 `backup-a2-deployed-20260922`**（A2 已部署版） |
| 18:47:08–18:47:41 | `tcb fn deploy healthApi --force`（COS 上传） | 部署成功；ModTime **18:47:36**，代码 11,169,553B（原 11,167,183B），运行时仍 Nodejs16.13（未升级） |
| 18:48–18:49 | 冒烟 4 项（见下） | 全部通过 |
| 18:49:12 | 清理冒烟数据 | attempts 删除 n=1、归零；family_auth 历史 13 条未动 |

## 部署内容摘要（相对云端原 A2 版的差异 = 收尾批次 + preflight 修正，共 2 个云端文件）

- `family-service.js`：noInvite 说明态；事务内邀请码一致性重验（重邀交错防线）；expiresAt 不可解析→INVALID、刚好到期→EXPIRED；原子预留频控（计数文档 + 条件更新，add 冲突按 E11000/duplicate key 签名判别，基础设施异常上抛不伪装频控）；重邀必发新码。
- `index.js`：`cloud.database({ throwOnNotFound: false })`（事务 doc.get 不存在→data:null，异常不吞）。
- 未动：sendDueReminders、运行时、数据库规则/索引、流量路由；未上传体验版。

## 冒烟结果（CLI 直调，openId=smoke-deploy-0922）

| # | 输入 | 实际返回 | 判定 |
|---|---|---|---|
| 4a | familyJoin 缺码 | `noInvite:true`、title"尚未获得邀请"、remainHours=0、scopes=[] | ✅ 收尾版判别特征命中 |
| 4b | inviteCode="abc123" | `inviteError.code=FAMILY_INVITE_INVALID` | ✅ |
| 4c | inviteCode="KXJ000000000"（格式合法不存在） | `inviteError.code=FAMILY_INVITE_NOT_FOUND` | ✅ |
| 4d | 查 family_invite_attempts | 恰 1 条计数文档：`_id=invite-fail-smoke-deploy-0922-2026-09-22`、count=2（两次失败累计于单文档）、day=北京日、createdAt 为 Date 型（TTL 可清理）、**不含邀请码明文** | ✅ 新计数结构在真实云端按设计工作 |

## 测试数据处理记录

- 本轮创建：family_invite_attempts 计数文档 1 条（openId=smoke-deploy-0922）→ 已按 openId 精确删除（n=1），集合归零。
- 未触碰：family_auth 13 条历史文档（部署前后 count 均 13）、family_members（0 条）、其他任何集合。
- 冒烟未产生成员关系或邀请文档（全部为失败/缺码路径）。

## 仍待验证（CLI 冒烟不能替代）

- 微信真实身份注入（P0-1，需开发者工具/真机走 wx.cloud.callFunction）；
- 并发性质：额度竞争、同码争抢、同成员并发加入两家庭、重邀交错（verification-plan §3）；
- add 重复键真实报文与 `/E11000|duplicate key/i` 签名匹配（verification-plan §4.1）；
- TTL 24h 实际清理时点（§4.4）。

## 回滚口径（如需）

- 仅回退收尾批次：`tcb fn config-route healthApi 2 100 -e kangxiaoji-d5gw2k203f0488a9e`（版本 2 = A2 已部署版）；
- 整体回退到 A0 之前：版本 1；
- 判别命令见 rollback-steps.md（缺码 invoke：收尾版 noInvite:true / A2 版与旧版 remainHours=24 默认页）。
