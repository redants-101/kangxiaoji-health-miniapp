# A3 修复 + A4–A7 测试环境部署记录 — 2026-09-23

环境：`kangxiaoji-d5gw2k203f0488a9e`（个人版，Normal，到期 2026-10-21；用户确认：无正式用户、不承载正式流量，仅测试）。
授权范围：只读核对 / 快照 / 仅部署 healthApi / 合成数据冒烟 / 仅清理本轮数据 / 手册输出。未做：正式发布、sendDueReminders 部署、运行时修改、索引/安全规则修改、历史数据删除、真实健康数据修改、app_configs 创建。

## 1. 部署前云端确认（只读，10:49–10:51）

| 项 | 值 |
|---|---|
| $LATEST ModTime | 2026-09-23 01:22:30（=A3 部署版，与 deploy-record-a3.md 一致） |
| 线上代码抽查 | actionMap 无 familyRecord*/setFamilyContactPhone/appConfig → 确为 A3 版 |
| 运行时 | Nodejs16.13；内存 256MB；超时 60s；代码 11,171,067B |
| 流量路由 | `get-route` 返回空表 → 无版本路由，100% 由 $LATEST 承接（已确认，非假设） |
| 版本快照 | v1 backup-before-a0a1a2-deploy（09-22 15:27:16）、v2 backup-a2-deployed-20260922（18:46:47）、v3 backup-a3-predeploy-20260923（09-23 01:21:47） |

## 2. 回滚快照（部署前创建）

| 项 | 值 |
|---|---|
| 快照名 | `backup-a4a7-predeploy-20260923` |
| 版本号 | **v4**（实际返回，非假设） |
| 创建时间 | 2026-09-23 10:51:33 |
| 代码范围 | 当前 $LATEST = A3 版（含 family-service 装配缺陷） |
| 回滚命令 | `tcb fn config-route healthApi 4 100 -e kangxiaoji-d5gw2k203f0488a9e` |
| 回滚判别 | familyView 探测：A4–A7 版对无绑定返回 `allowed:false,reason:noBinding`；A3 版同（更早缺陷版会 TypeError）；appConfig key：新版返回 `{familyTabEnabled:null}`，A3 版返回"未知数据标识" |

## 3. 部署（仅 healthApi）

| 项 | 值 |
|---|---|
| 命令 | `tcb fn deploy healthApi --force`（COS 上传，工作区目录打包） |
| 完成时间 | 2026-09-23 10:52:20（$LATEST ModTime；CLI 报成功 10:52:24） |
| 运行时 | Nodejs16.13（**未变**，符合"不修改运行时"约束） |
| 代码体积 | 11,176,117B（+5,050B vs A3 版） |
| 流量路由 | 部署后 `get-route` 仍为空表 → $LATEST 承接 100%（未改路由） |

**部署包完整性核对**（对线上代码文本检索）：
- 3 个共享模块引用在包内：`require('./family-policy')`、`require('./payload-validation')`、`require('./payload-helpers')` 命中（模块缺失会导致全部路由 Cannot find module，冒烟 S1–S10 全通过为运行时佐证）；
- 新路由在线上 actionMap/keyMap：familyRecordBloodPressure / familyConfirmMedication / setFamilyContactPhone / familyGetReminderPhone / appConfig 命中；
- **A3 装配缺陷已被覆盖**：线上代码含 getRecordService/getMedicationService/getDailyStatsService/canPerformScopeAction/canCallReminderPhone 注入（与本地 27/27 装配比对一致）；冒烟 S5a/S6a-c 家属数据路由干净拒绝、S8b 真实关系读取成功，无 TypeError——缺陷修复的运行时证明。

**部署内容**：A3 家属只读闸口+装配修复；A4 四写路由+审计；A5 无云端改动（客户端缓存治理）；A6 电话（2 action + homeFamily/familyAuth 字段 + getFamilyData 守卫 + static-pages 条款）；A7 appConfig 只读路由。sendDueReminders 未部署（零改动）。

## 4. 本地验证（部署前，真实退出码）

| 检查 | 结果 | 退出码 |
|---|---|---|
| 目标测试（A3–A7 六套件） | 93/93 | **0** |
| `npm test -- --runInBand`（全量） | **633/633**，29 套件全过（10:47 运行，北京时间 08:00 后，settings 时区对通过；窗口内会失败 2 例，台账在案，未伪装） | **0** |
| `npm run regression` | ok | **0** |
| `npm run lint` | 43 problems = **11 errors（全部历史基线，本批新增 0）** + 32 warnings | **1**（errors>0 的基线既有状态） |

工作区核验：分支 feat/family-permission、HEAD a751776、暂存区空、53 文件跟踪改动（+2426/−1453）与上一份只读核验报告**完全一致（无新代码变化）**；共享模块与 feature-flags.js 在盘；A4–A7 关键代码均在工作区（8 项 OK）而非仅历史补丁。

原始输出：target-tests.txt / full-test.txt / regression.txt / lint.txt（本目录）。

## 5. 冒烟（详见 smoke-record.md）

S1–S10 全部通过；合成写入 4 文档已全部精确清理（cleanup-record.md）；未触碰历史 family_auth / family_members / attempts 数据。

## 6. 体验版上传

CLI 上传尝试 1 次失败（GENERIC_ERROR，electron 通道既有故障，未重试、未成功）→ 转人工手册（upload-manual.md）。**当前体验版仍是旧包（0.9.0，含 A3 验收前页面），A3 修复/A4–A7 前端未上传**；云端已就绪。

## 7. 结论

- 云端：A3 修复 + A4–A7 服务端已部署并冒烟通过（合成身份级）。
- 前端：待人工上传体验版 0.10.0。
- **双手机真机验收：待体验版上传并设置后即可开始**（手册与截图清单已备）；本轮不宣称真机验收完成，不进入 A8，不涉及正式发布。
