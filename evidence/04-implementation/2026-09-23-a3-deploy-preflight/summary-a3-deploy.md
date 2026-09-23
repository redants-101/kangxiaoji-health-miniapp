# A3 云端部署与双手机验收（执行批）· 摘要（2026-09-23）

- 批次：实施批次 A3-deploy（部署 + 冒烟 + 验收准备）；**未进入 A4**。
- 用户确认项：体验版含 A7 家庭 Tab 开放；用药趋势分母限制延期；仅脱敏测试数据、验收后清理。
- 环境：CloudBase CLI 3.8.4；环境 `kangxiaoji-d5gw2k203f0488a9e`；Node v22.23.2/npm 10.9.8（本地检查）。

## 1. 已完成（服务端）

1. 回滚快照 **v3 `backup-a3-predeploy-20260923`**（01:21:47）；
2. **healthApi 部署**（01:22:30，仅该函数；sendDueReminders/索引/规则/运行时未动）；
3. 冒烟 5 项全过：familyView 无绑定 `denied noBinding`；familyJoin 缺码 `noInvite:true`（不回退）；不存在码显式 NOT_FOUND；测试邀请 pending 预览 remainHours=24；改过期后 EXPIRED；
4. 测试数据清理：测试邀请删除（family_auth 归 0）、本轮冒烟计数删除（n=2）；剩余 4 条 attempts 属上轮真机 S07 数据（TTL 清理）；
5. 证据：deploy-record-a3.md、dual-phone-acceptance.md（含执行分工更新）、本摘要。

## 2. 未完成（转人工/下一轮）

| 项 | 状态 | 说明 |
|---|---|---|
| 体验版上传 | **待用户** | DevTools CLI upload 被 electron winId 缺陷阻断（login✓ open✓ 仍失败）；手动步骤见 deploy-record-a3.md §4（IDE 上传 0.9.0 → 公众平台设体验版，或重启 IDE 重试 CLI） |
| 双手机验收 P1–P3、验收 1–9、截图 F01–F05 | **待用户（手机）** | runbook 见 dual-phone-acceptance.md；截图与同次接口响应分开归档 |
| 服务端佐证与验收后清理 | 下一轮代跑 | B 的 openId 从云函数日志取；响应证据 invoke/只读查询导出；清理按 openId/邀请码精确删除 |

## 3. 验证层级口径（沿用）

服务端响应已验证 / 页面只读状态已验证 / 仅页面隐藏 / 尚未验证——验收 9 项逐项标注于 dual-phone-acceptance.md；截图不单独证明服务端过滤。

## 4. 回滚

`tcb fn config-route healthApi 3 100 -e kangxiaoji-d5gw2k203f0488a9e`（或 2）；判别：familyView 探测响应差异（A3=denied noBinding；A2=按 self 返回）。

## 5. 边界

未进入 A4；未改索引/规则/运行时；未上传体验版；双手机物理操作与公众平台操作不在助手能力内，已列精确步骤。
