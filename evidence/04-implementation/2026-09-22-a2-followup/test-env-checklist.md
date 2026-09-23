# 测试环境联调与截图准备清单（A2 收尾后）

> 状态口径：✅=已就绪；⚠️=待验证/待执行（**未完成前请勿开始截图**）。

## 1. 环境与实际状态

| 项 | 状态 | 说明 |
|---|---|---|
| 云环境 | ✅ | `kangxiaoji-d5gw2k203f0488a9e`（个人版，Normal，ap-shanghai） |
| healthApi 云函数 | ⚠️ **待重新部署** | 云端现为 A2 部署版；**本批（noInvite 态、原子频控、交错防线、有效期边界、throwOnNotFound）尚未上云**。部署命令：`tcb fn deploy healthApi --force -e kangxiaoji-d5gw2k203f0488a9e`（建议先 `tcb fn publish-version healthApi "backup-before-a2-followup"` 留回滚点） |
| sendDueReminders | ✅ 无需部署 | 本轮零改动 |
| 运行时 | ✅ Nodejs16.13 | 未升级（A-1 独立阶段） |
| 小程序前端 | ⚠️ 待上传体验版 | family-join/auth/invite 页改动需在微信开发者工具上传后，测试账号方可看到新状态 |

## 2. 集合 / 索引 / 安全规则

| 项 | 状态 |
|---|---|
| family_invite_attempts 集合 | ✅ 已建（当前为空，新旧计数形态无共存冲突） |
| createdAt TTL 24h | ✅ 已建（expireAfterSeconds=86400） |
| family_auth.inviteCode sparse 唯一索引 | ✅ 已建（inviteCode_unique；旧非唯一索引已删；2 条空串码遗留文档已 $unset） |
| family_auth / family_members / family_invite_attempts 安全规则 | ✅ 均 ADMINONLY（仅云函数读写） |
| 待验证：并发预留串行化、事务锁时序、add 撞 _id 错误形态、TTL 实际清理 | ⚠️ 部署后压测/观察 |

## 3. 测试账号与数据准备（截图前置）

| 需求 | 状态 | 说明 |
|---|---|---|
| 测试账号 A（owner，脱敏昵称） | ⚠️ 待用户准备 | 开发者工具"普通编译"登录态即可 |
| 测试账号 B、C（家属） | ⚠️ 待用户准备 | 真机预览/体验版第二、第三个微信号，或开发者工具多账号调试 |
| 测试邀请码 | ⚠️ 部署后由账号 A 生成 | 不得使用真实用户数据 |
| 云端历史测试数据 | ⚠️ 待用户决定 | family_auth 现存 13 条历史测试文档（11 条 pending 带码）；截图用新邀请即可，是否清库由用户定 |
| 真机调试悬浮条 | ⚠️ 截图前关闭 | |

## 4. 每张截图：路径、参数、操作与预期文案

页面路径均为 `pages/family-sub/family-join/index`（加入页），保存目录 `evidence/04-implementation/visual-input/screenshots/`，文件名日期用实际执行日。

| 文件 | 进入参数 | 操作 | 预期画面/文案 |
|---|---|---|---|
| A2-S01-join-loading-YYYY-MM-DD.png | `?inviteCode=<有效码>` + 开发者工具 Network 弱网（或 Throttling） | 打开页面瞬间截取 | 状态面板"正在加载加入信息 / 家属身份、授权范围和加入确认会在加载后展示。" |
| A2-S02-join-pending-YYYY-MM-DD.png | `?inviteCode=<账号A新生成的有效码>` | 正常打开 | "邀请有效 · 剩余 N 小时"徽标 + 可查看内容（仅 read 项）+ 加入身份 + "加入家庭"按钮可用 |
| A2-S03-join-invalid-YYYY-MM-DD.png | `?inviteCode=KXJ000000000`（格式合法但不存在）或任意乱码 | 打开 | 标题"邀请不存在"（或"邀请码无效"）+ 文案"邀请不存在或已失效"/"邀请码无效，请核对后重试" + 重新加载按钮；**无加入按钮** |
| A2-S04-join-expired-YYYY-MM-DD.png | 有效码生成后，云控制台把该 family_auth 文档 expiresAt 改为过去时间（仅测试数据） | 打开 | 标题"邀请已过期" + "邀请已过期，请让家人重新发起" |
| A2-S05-join-revoked-YYYY-MM-DD.png | 有效码加入成功后，账号 A 对该成员执行"解除授权"，再用同码打开（账号 C） | 打开 | 标题"邀请已撤销"或"邀请已被使用"（视撤销路径落到的状态，二者均为预期错误态；截图页备注实际状态） |
| A2-S06-join-used-YYYY-MM-DD.png | 账号 B 先成功加入某码，账号 C 再打开同一码 | 打开 | 标题"邀请已被使用" + "邀请已被其他家属使用" |
| A2-S07-join-rate-limited-YYYY-MM-DD.png | 同一测试账号连续 20 次打开无效码页面（每次计入 1 失败），第 21 次打开任意码 | 打开 | 标题"尝试过于频繁" + "今日尝试次数过多，请明天再试"；当日该账号所有邀请查询均此态，**次日（北京日界）自动恢复** |

补充说明：

- **无邀请码说明态**（本批新增，不在 7 张清单内）：直接打开 `pages/family-sub/family-join/index`（不带参数）应显示"尚未获得邀请 / 请通过家人分享的邀请链接或邀请码进入。"，无有效期徽标、无加入按钮——建议顺手截一张留档（命名建议 `A2-S08-join-noinvite-YYYY-MM-DD.png`）。
- S04/S05/S07 依赖部署后行为（有效期拒绝、频控额度）——**healthApi 重新部署完成前不要执行**；无法自然触发的状态记录"待测试环境触发"，不修改生产数据摆拍、不伪造。
- expiresAt 缺失态（矩阵 #7）现网新码必带有效期，无法自然触发，仅留记录。

## 5. 联调验证顺序建议（部署后）

1. 冒烟：CLI invoke familyJoin 无效码 → 应返回 `inviteError.code=FAMILY_INVITE_INVALID`（本批口径）且 family_invite_attempts 出现计数文档 `invite-fail-<openId>-<day>`；
2. 缺码 invoke → 返回 `noInvite:true`、remainHours=0、scopes=[]；
3. 开发者工具双账号走完整链路：邀请 → 加入 → 家属首页 → 改权 → 撤销；
4. 并发压测（可选脚本）：同 openId 并发 25 个无效码查询 → 断言计数文档 count==20、5 个响应为 RATE_LIMITED；
5. P0-1：核对云函数日志中 event.userInfo.openId 注入是否稳定。
