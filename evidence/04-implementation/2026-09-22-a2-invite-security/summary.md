# 实施批次 8 · A2 邀请安全、错误态与频控 · 摘要

> **修正说明（2026-09-22 A2 收尾批次追加，原文保留为历史记录）**
> 1. 原 §4 称频控"先查后写非原子，并发突发可小幅越过 20（软上限，可接受）"——该"可接受"结论**未经用户确认，不应写入**。收尾批次已改为**原子预留额度**方案（每 (openId, 北京日) 单计数文档 + `where({_id,count:_.lt(20)}).update(_.inc(1))` 条件更新，依据 MongoDB 单文档写原子性），并发请求不可能全部先过门限再探测；方案与来源见 `../2026-09-22-a2-followup/rate-limit-plan.md`。
> 2. 原实现"每次失败一条记录"的 attempts 文档形态已改为计数文档形态（原形态无生产数据，无迁移）；"不含邀请码明文"承诺保持并被新形态测试继续固化。
> 3. 原 §1 缺码返回"默认说明页（remainHours=24 + 默认可查看范围）"已改为 `noInvite` 明确说明态：无有效期、无范围、无有效标志、禁止提交。
> 4. 原"重邀命中自己旧码不算冲突"的豁免已取消：重邀必发新码，旧码即刻失效。

- 日期：2026-09-22（14:16–15:05，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 环境：Node v22.23.2 / npm 10.9.8；既有全部改动保留；未切分支、未提交、未清理、未部署。
- 数据流审查：`data-flow-review.md`；错误码与页面状态矩阵：`error-state-matrix.md`。

## 1. 本地已验证（测试先行：实现前 25 失败 → 实现后全绿）

新增 `tests/unit/a2-invite-security.test.js` **30 个用例**，全部通过：

- **错误态与错误码**（getFamilyJoinData，签名改为 `(openId, payload)`）：缺失码返回默认说明页不计数；格式错误 INVALID；不存在 NOT_FOUND；**expiresAt 缺失一律 INVALID（decisions #15，移除旧 24h 兼容回落）**；过期 EXPIRED；撤销 REVOKED；他人已用 USED；正常 pending 预览（scopes 仅 read 项、remainHours>0、零计数）。
- **频控**（decisions #10）：openId + **北京自然日**（getTodayDateValue，云函数 UTC 环境必须用北京日界）；第 1/20 次失败允许并记录、第 21 次拒绝（RATE_LIMITED）且拒绝不计数；昨日 20 条不影响今日（fake timers 固定时钟）；按调用者隔离；**join 动作与查询共用同一门限**，直接刷 join 同样被拒（防绕过）；attempts 文档字段仅 `openId/day/reason/createdAt`，测试断言 JSON 全文**不含邀请码明文**。
- **失败路径零污染**：任何错误态下 family_members 零写入、family_auth 不被改 active。
- **唯一性前置检查**：候选码与他人文档冲突→重生成用新码；连续 3 次冲突→抛错且零写入；owner 单文档重邀命中自己旧码不算冲突。
- **本地镜像**（decisions #15 的 joinLocal 部分）：过期拒绝（code EXPIRED）、缺 expiresAt 拒绝（INVALID）、码不匹配拒绝（NOT_FOUND）、有效正常镜像；createFamilyInviteLocal 镜像写入 expiresAt。
- **页面消费契约**：normalizeFamilyJoinData 透传 inviteError；`services/core.js` requestCloud/requestCloudByKey 抛错附 `error.code`（来自 main 出口新增的 `errCode` 字段）；family-join 页按码表渲染 8 种错误态标题 + 提交守卫 + join 失败后刷新状态。

| 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|
| 实现前目标测试 | 1 | **25 失败/5 通过**（30 总） | `before.txt` |
| 实现后目标测试 | **0** | **30/30** | `after.txt` |
| `npm run regression` | **0** | ok（B1 四组真实执行；桩邀请码升级为合法 12 位格式） | `regression.txt` |
| 全量 `npm test -- --runInBand` | **0** | **505/505，21 套件全过**（475 + 30） | `full-test.txt` |
| `npm run lint` | 1 | **11 error/32 warning**：零新增；family-join 页 loadData 因补 await 消除 1 个历史 warning（33→32） | `lint.txt` |

lint 检查范围：services/utils/pages/components；**cloudfunctions 不在范围内**（B6 未实施）。settings 时区台账保留：本轮北京下午执行全绿，凌晨 00:00–08:00 该套件仍会失败 2 个，未等待、未掩盖。

补丁：`fix.patch` 以重放全部历史补丁（B1→…→A1）的基线树为基准，11 段（10 改 + 1 新增）；已验证干净应用且与工作区逐字一致。对既有批次的触碰仅限：三个测试/回归文件的**桩邀请码格式升级**（适配新格式校验）与 COLLECTIONS 补 `inviteAttempts` 键，无断言放宽、无用例删除。

## 2. 代码已实现、需云端验证

1. **inviteCode 并发唯一性**：代码只有生成前查重（前置检查，最多重试 3 次）；并发窗口内两请求同码写入的最终防线是 **family_auth.inviteCode sparse 唯一索引**——本地 Mock 无法证明，建索引后需在测试环境实测并发邀请。
2. **频控原子性**：计数-写入为"先查后写"，非原子；并发突发可小幅越过 20（软上限，可接受，无越权后果）。真实并发行为待云端压测确认。
3. attempts 文档 `_openid` 平台写入规则与本实现显式 `openId` 字段的关系（decisions 4.5 既有验证点）。
4. main 错误出口新增 `errCode` 字段对既有客户端的兼容性（旧前端忽略该字段，理论无影响，云端联调时确认）。
5. getFamilyJoinData 路由现在依赖 `getOpenId(event)`——微信云调用 openId 注入可靠性（P0-1 既有验证点）随本接口一并核验。

## 3. 需要用户在 CloudBase 控制台完成（代码无法代替，本批未操作云端）

> **完成更新（2026-09-22 15:20）**：以下 4 项已在用户授权登录（tcb login）后经 CloudBase CLI 完成并逐项验证，含一次遗留空串 inviteCode 文档的 `$unset` 清理与 family_invite_attempts 由 PRIVATE 收敛为 ADMINONLY；完整过程、命令与前后状态见本目录 `console-operations.md`。云函数尚未部署，A2 代码仍未上云。

1. 创建集合 `family_invite_attempts`；
2. `family_invite_attempts.createdAt` 建 **TTL 索引（24h）**；
3. `family_auth.inviteCode` 建 **sparse 唯一索引**；
4. `family_invite_attempts` 与 `family_auth` 安全规则核查：仅云函数可读写。

## 4. 需要用户人工截图（本批到此停止，未截图、不宣称已截图）

在微信开发者工具（测试环境、脱敏测试账号与测试邀请码、关闭真机调试悬浮条、不含密钥/路径/账号隐私）人工触发并保存至 `evidence/04-implementation/visual-input/screenshots/`：

| 文件 | 状态 | 触发方式 |
|---|---|---|
| `A2-S01-join-loading-2026-09-22.png` | 加载态 | 弱网/节流下打开加入页 |
| `A2-S02-join-pending-2026-09-22.png` | 正常 pending 预览 | 有效测试邀请码 |
| `A2-S03-join-invalid-2026-09-22.png` | 无效邀请码 | 随机不存在/格式错误码 |
| `A2-S04-join-expired-2026-09-22.png` | 已过期 | 测试环境将测试邀请 expiresAt 改为过去时间 |
| `A2-S05-join-revoked-2026-09-22.png` | 已撤销 | 对测试邀请执行撤销 |
| `A2-S06-join-used-2026-09-22.png` | 已被他人使用 | 测试账号 B 先加入，测试账号 A 再打开 |
| `A2-S07-join-rate-limited-2026-09-22.png` | 频控拒绝 | 同一测试账号连续 20 次失败查询后再查 |

注意：S04/S05/S07 若当前测试环境无法自然触发，**记录"待测试环境触发"即可，不得修改生产数据摆拍、不得伪造截图**；expiresAt 缺失态（矩阵 #5）现网新码必带有效期，无法自然触发，同样只记录。

## 5. 未进入的后续批次

A3 二级页家属态、A4 代录写路径（含 _openid 归属最小 demo 验证）、A5 缓存治理与撤销实时生效、A6' 电话提醒、A7 Tab 开放/删死页/回滚开关、Node18 升级、全仓 Lint 与日期副本收敛——均未进行。本批未修改 A1 成员隔离逻辑（仅 assertJoinableAuth 内部改用统一分类器，消息文案与 A1 断言完全一致）；未实现二级页权限、代录、电话提醒；未开放 Tab。

## 6. 累计未提交改动（截至本轮结束）

已跟踪修改 **18 个**（本批新增 services/core.js、pages/family-sub/family-join/index.js、pages/family-sub/family-join/index.wxml 三个跟踪修改）；新增未跟踪代码 **8 个**（payload-helpers.js、payload-validation.js、family-policy.js、shared-policy.test.js、a0-permission-policy.test.js、a0-contract-integration.test.js、a1-member-isolation.test.js、**a2-invite-security.test.js（本轮）**）。另含既有 docs 分析文档、历史截图与 evidence/。本批结束即停止，等待用户人工截图，不进入 A3。
