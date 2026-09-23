# A2 数据流审查：邀请安全、错误态与频控

- 日期：2026-09-22（14:16 起，UTC+8）
- 依据：decisions.md 第 9/10/11/15 项、A1 summary 与 data-flow-review
- 方法：通读 family-service.js（getFamilyJoinData/joinFamilyByInvite/createFamilyInvite）、index.js 路由与 main 错误出口、services/core.js requestCloud 链、family-join 页面。

## 1. getFamilyJoinData 现状（A0-2/A1 后）

- 签名 `getFamilyJoinData(payload)`，路由 `'familyJoin': () => ...(payload)` —— **拿不到调用者 openId**，无法按调用者频控（本批改为 `(openId, payload)`）。
- 有码时按 inviteCode 查 family_auth：查到 → 一律返回预览数据，**不区分** pending/active/revoked/过期，无任何错误码；查不到 → 静默返回通用默认页。**"错码返回通用页"正是 decisions 第 9 项要放弃的现状**。
- `expiresAt` 缺失时回落 `Date.now()+24h` 计算 remainHours —— 与 decisions 第 15 项"无 expiresAt 一律无效"冲突，本批移除该兼容。

## 2. family_auth 字段关系

| 字段 | 写入点 | 读取点 | 现状问题 |
|---|---|---|---|
| inviteCode | createFamilyInvite 生成（`KXJ`+4 位时间+5 位随机） | join/joinData 按码查询 | **无唯一性保障**：生成不查重，云端唯一索引未建（控制台事项） |
| status | 创建 pending；join 成功 active；撤销 revoked | join 校验 active+memberOpenId | joinData 完全不看 status |
| expiresAt | 创建时 now+24h | join 校验（**仅当存在时**） | 缺失被放过（违反 #15）；joinData 缺失回落 24h |
| memberOpenId | join 写入；A1 重邀清空 | join 的 used 判定 | 正常 |

## 3. family_invite_attempts：**不存在**

全仓（代码/配置/测试）无任何引用。本批新增：代码侧写入/计数 + 控制台侧建集合、TTL 索引、安全规则（见 §6）。

## 4. 查询与写入边界（本批遵守）

- getFamilyJoinData：只读 family_auth；新增**只写** family_invite_attempts（失败记录）；任何路径不写 family_members、不改 family_auth。
- joinFamilyByInvite：异常路径（含频控拒绝）零写入；成功路径写入范围与 A1 完全一致（本人锚点/关系行 + 该邀请文档 active）。
- createFamilyInvite：新增按候选码查重（只读 family_auth）；写入仍限 owner 单文档。

## 5. 页面与客户端错误消费现状

- `services/core.js` requestCloud / requestCloudByKey：`throw new Error(result.errMsg)` —— **errCode 丢失**，页面只能拿到文案。本批在抛错处附带 `error.code = result.errCode`（错误展示链路的最小改动）。
- `index.js` main catch：返回 `{errMsg, stack}` —— 本批追加 `errCode: err.code || ''`。
- family-join 页面：loadPageData 失败 → loadError 面板（网络失败态已有）；joinFamily catch → toast 文案。**没有邀请错误态**（无效/过期/撤销/已用/频控），本批新增 `inviteError` 渲染分支与提交守卫。
- 页面在小程序包内，**不能** require 云函数目录模块；错误码字符串在页面侧以字面量映射标题（码表契约在 family-policy.js 单点定义，页面复制的是稳定字符串常量，非逻辑）。

## 6. 需要 CloudBase 控制台完成的事项（代码无法代替，本批不操作云端）

1. 创建集合 `family_invite_attempts`；
2. `family_invite_attempts.createdAt` 建 **TTL 索引（24h）**（decisions #10）；
3. `family_auth.inviteCode` 建 **sparse 唯一索引**（decisions #11）——代码侧只有生成前查重（前置检查），**并发唯一性最终靠该索引**；
4. 两集合安全规则核查：仅云函数可读写（初始化清单 L37 口径）。

## 7. 频控与并发口径（如实声明）

- 计数键：调用者 openId + **北京时间自然日**（`getTodayDateValue()`，与全仓日期口径一致；云函数运行在 UTC，必须用北京日界，否则 0-8 点计数串日）。
- 门限：当日失败记录 ≥20 → 拒绝继续查询/加入（第 21 次起被拒），拒绝本身不再计数。
- 计数-写入为"先查后写"，**非原子**：并发突发可能小幅越过 20（软上限，可接受）；本地 Mock 无并发能力，不能据此宣称原子性——真实并发行为列入云端待验证。
- 防绕过：join 动作与 joinData 查询**共用同一计数与门限**，直接刷 join 接口同样被限。
- 隐私：attempts 文档只存 openId、day、reason（错误码）、createdAt；**不存邀请码明文**；perf 日志只含 step 名；错误文案不含码/openId。

## 8. 错误码契约（本批定义，页面稳定消费）

| code | 触发 | 页面状态 |
|---|---|---|
| FAMILY_INVITE_NOT_FOUND | 格式正确但不存在 | 无效邀请 |
| FAMILY_INVITE_INVALID | 格式错误 / expiresAt 缺失（#15 一律无效） | 无效邀请 |
| FAMILY_INVITE_EXPIRED | 已过 expiresAt | 已过期 |
| FAMILY_INVITE_REVOKED | status=revoked | 已撤销 |
| FAMILY_INVITE_USED | status=active 且绑定他人 | 已被使用 |
| FAMILY_INVITE_SELF | 加入自己创建的邀请（既有语义补码） | 不可加入 |
| FAMILY_MEMBER_BOUND | 已绑定另一位老人（A1 既有语义补码） | 已绑定 |
| FAMILY_INVITE_RATE_LIMITED | 当日失败 ≥20 | 频控拒绝 |

频控码与邀请码错误**严格分离**，不混用。判定顺序：频控门限 → 格式 → 存在性 → expiresAt 缺失 → revoked → used → expired。
