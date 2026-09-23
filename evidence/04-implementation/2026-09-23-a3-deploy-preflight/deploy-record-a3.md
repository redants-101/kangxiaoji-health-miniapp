# A3 云端部署记录（2026-09-23）

- 执行：2026-09-23 01:21–01:35（UTC+8）；CloudBase CLI 3.8.4；环境 `kangxiaoji-d5gw2k203f0488a9e`。
- 用户已确认：体验版包含 A7 家庭 Tab 开放代码；用药趋势分母限制延期；仅脱敏测试数据、验收后清理。

## 1. 回滚快照与部署

| 时间 | 动作 | 结果 |
|---|---|---|
| 01:21:47 | `tcb fn publish-version healthApi "backup-a3-predeploy-20260923"` | **v3** 发布成功（代码同 v2/A2 版） |
| 01:22:02–01:22:34 | `tcb fn deploy healthApi --force`（COS 上传） | 成功；ModTime **2026-09-23 01:22:30**；体积 11,171,067 B（A2 版 11,169,553 B，+1,514 B = A3 代码）；运行时仍 Nodejs16.13 |
| — | 未部署 sendDueReminders；未改索引/安全规则/运行时 | ✅ |

**回滚命令**：`tcb fn config-route healthApi 3 100 -e kangxiaoji-d5gw2k203f0488a9e`（或 2，代码相同）；判别：familyView 探测——A3 版对无绑定返回 `allowed:false, reason:noBinding`，A2 版无闸口按 self 返回本人数据。

## 2. 冒烟验证（真实云调用）

| # | 调用 | 实际响应 | 判定 |
|---|---|---|---|
| 1 | key=trend, payload.familyView=true, openId=smoke-a3-nobind | `{"familyView":{"allowed":false,"reason":"noBinding"}}` | ✅ A3 闸口生效 |
| 2 | key=familyJoin, 缺码 | `"noInvite":true` | ✅ A2 行为不回退 |
| 3 | key=familyJoin, 不存在码 KXJ096FR2FTL | `FAMILY_INVITE_NOT_FOUND`（显式错误态，非旧默认页） | ✅ |
| 4 | 测试邀请 KXJ20ZH6F3FD（smoke-a3-owner 创建）→ familyJoin | 预览 `remainHours:24`、无 inviteError | ✅ pending 预览生产验证 |
| 5 | 将同一邀请 expiresAt 改为过去（测试数据写）→ familyJoin | `FAMILY_INVITE_EXPIRED` | ✅ 过期闸口生产验证 |

注：`$date` 字面量在 RunCommands update 中被拒（InvalidParameter），改用 ISO 字符串写入测试数据；闸口用 `new Date()` 解析，字符串/Date 均兼容。

## 3. 测试数据清理记录

| 动作 | 结果 |
|---|---|
| 删除 family_auth 测试邀请 KXJ20ZH6F3FD | n=1，集合剩余 **0** |
| 删除本轮冒烟频控计数（smoke-a3-nobind/joiner/owner） | n=2 |
| family_invite_attempts 剩余 | **4 条**——属上一轮真机 S07 截图的测试计数（非本轮创建），TTL 24h 自动清理；是否手动清理由用户决定 |

## 4. 体验版上传：CLI 受阻，转用户步骤

- DevTools CLI 位于 `D:\software\Tencent\微信web开发者工具\cli.bat`；`islogin` = true；`cli open --project …` 成功（IDE server 127.0.0.1:11153）；
- `cli upload` 反复失败：`winId is not found in _winIdAndProjectPathMap in electron mode`（DevTools electron 模式已知缺陷：项目窗口未注册进 CLI 的窗口映射；重启 IDE 后重试或改 UI 上传可绕开）。

**用户手动上传步骤**：
1. 开发者工具打开本项目（若已开则重启一次工具再开）；
2. 工具栏「上传」→ 版本号 `0.9.0` → 描述「A3 家属只读闭环 + A7 家庭Tab本地开放（测试体验版）」；
3. 微信公众平台 mp.weixin.qq.com → 版本管理 → 将 0.9.0 开发版「设为体验版」；
4. 或重启 IDE 后重试：`cli.bat upload --project "<项目路径>" --version 0.9.0 --desc "…"`。

## 5. 双手机验收执行分工

- **人工（手机/平台）**：体验版上传与设体验版；手机 A 登录 owner 微信、手机 B 登录家属微信；P1 生成邀请（家庭页→邀请家属→生成）、P2 B 扫码加入、验收 1–9 的页面操作与截图 F01–F05；
- **服务端佐证（可由我在下一轮代跑）**：每步后用 `tcb fn invoke`（B 的真实 openId 可从云函数日志取：`tcb fn log healthApi` 找 familyView 调用的 userInfo）或 `tcb db nosql execute` 只读查询，导出同次响应作为网络证据配对截图；
- **验收后清理（下一轮代跑）**：撤销/删除本轮绑定与邀请、删除本轮频控计数（按 openId 精确）。

截图与接口响应分开归档；无同次 Network 证据时不声称截图证明了服务端过滤（见 dual-phone-acceptance.md）。
