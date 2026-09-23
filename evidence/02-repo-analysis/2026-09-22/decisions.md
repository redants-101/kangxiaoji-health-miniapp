# 家庭权限二开 · 业务决策记录（阶段 2 → 阶段 3 输入）

- 决策日期：2026-09-22
- 决策来源：用户口头确认（代录范围、绑定关系、read 粒度、remind 形态、missedNotice 归属、关系名单、存量口径）；第七组（页面与安全策略）、第八组（工程边界）由用户委托实施方决定。
- 约束：本记录仅新增于 evidence 目录；截至本记录写入时未修改任何业务代码（HEAD 仍为 `a751776`，分支 `feat/family-permission`）。
- 本记录是 `2026-09-21/file-impact-list.md` 第 5 节"待拍板项"的结案与修订依据；与之冲突处，以本记录为准。

---

## 1. 用户已拍板项

| # | 议题 | 决定 |
|---|---|---|
| 1 | 代录（write）范围 | **开放：血压代录、血糖代录、用药代确认（已服/跳过）**。**不开放：用药计划增删改、健康记录删除**（即使 write=true，计划管理与删除仍仅 owner）。 |
| 2 | 家属-老人绑定关系 | **一位家属只能关联一位老人**（memberOpenId 维度 1:1）。一位老人可被多位家属关联（owner 1:N member）。 |
| 3 | read 粒度 | **维持四块开关**：bloodPressure / bloodGlucose / medicine / report，不做字段级、时间范围级细分。 |
| 4 | remind 形态 | **不做微信订阅消息家属推送**（个人开发者主体，订阅消息限制大）。改为：**家属端展示"电话提醒"入口，调用 `wx.makePhoneCall` 拨打老人侧配置的联系电话**；提醒类信息（漏服/未记录/周报状态）按 noticeRules 控制是否对家属可见。 |
| 5 | missedNotice 归属 | **从 scopes 中移除，并入 noticeRules**。其语义与 noticeRules.missedMedicine（用药未确认提醒）重复，决定直接取消 missedNotice key，不另设新规则。 |
| 6 | 关系类型名单 | 采用设计稿 8 种（qa/designs/P2-4 L34-L43）：女儿/主要照护人、儿子/紧急联系人、配偶/共同管理、孙女/主要照护人、孙子/主要照护人、兄弟姐妹/共同管理、护工/协助管理、家属/共同管理（other 文案由"其他/自定义关系"改为"家属/共同管理"）。 |
| 7 | 存量兼容 | **线上无真实家庭数据，不做兼容、不做 backfill**：scopes 直接落三级新结构；不保留 enabled→三级的运行时映射分支；旧邀请码不做"无 expiresAt 永不过期"兼容。 |

## 2. 委托实施方决定项（第七组：页面与安全策略）

| # | 议题 | 决定 | 理由 |
|---|---|---|---|
| 8 | 死页 `pages/family-sub/index` | **删除**（js/wxml/wxss/json 四个文件 + `app.json` L52 分包注册项） | 仅 3 个跳转按钮、routes 无键、全仓无入口（pages/family-sub/index.js L12-L22）；invite/join/auth 已有各自路由，保留只会产生不可达维护面 |
| 9 | 邀请码错误反馈 | getFamilyJoinData **按 无效/过期/已撤销/已被他人使用 显式返回错误码与文案**，family-join 页展示；放弃当前"错码返回通用页"（family-service.js L359-L371） | 12 位码（KXJ+9 字符）+ 频控 + 唯一索引后枚举收益极低；通用页让正常用户无法分辨码错还是网络问题 |
| 10 | 邀请枚举频控 | 新增轻量集合 **`family_invite_attempts`**：按调用者 openId 记录失败查询，**超过 20 次/自然日拒绝**；建 TTL 索引（24h，云控制台手工建） | 云函数实例无状态，内存计数不可靠；单集合成本低，日志不记录邀请码明文 |
| 11 | inviteCode 唯一索引 | 云控制台对 family_auth.inviteCode 建 **sparse 唯一索引**（Schema L251 早已标注"需要唯一约束"） | 防止并发/重试产生重复码；**控制台操作，列入部署清单，代码无法代替** |
| 12 | 联系电话展示口径 | owner 在邀请/授权页**手动填写"提醒电话"**（默认老人本人号码、可改为紧急联系人）；接口仅在该家属 remind=true 时返回号码；列表/卡片中**脱敏展示**（138****1234），点击"电话提醒"由 `wx.makePhoneCall` 唤起系统拨号（系统拨号盘会显示完整号码，属平台行为，在授权文案中说明）；号码可随时修改/清空；撤销授权后接口立即不再返回 | 个人主体无法使用 wx.getPhoneNumber；号码属敏感个人信息，最小暴露 + 显式授权 + 可撤回；遵循文档已有原则"生产日志不输出手机号"（docs/健康管理微信小程序独立开发可行性分析.md L344） |

## 3. 委托实施方决定项（第八组：工程边界）

| # | 议题 | 决定 | 理由 |
|---|---|---|---|
| 13 | 云函数运行时 | **Nodejs16.13 → Nodejs18.15 升级作为独立前置阶段**：先修 B1 回归 → 测试环境升 runtime（cloudbaserc.json L11/L21）→ 回归全绿后单独部署，再开始权限改造 | Node16 已 EOL；与权限改动分批部署可隔离故障归因；P0-2 已有设计稿 |
| 14 | 趋势页失败测试契约 | **以 bpBg 复合指标新模型为准**，更新 tests/unit/page-data-consistency.test.js L34-L52 两处断言（metricOptions=[bpBg,medication]、activeMetric='bpBg'） | 云端 getTrendData 与其余 10 个趋势用例已按 bpBg 实现（09-21 test.txt L63-L79），失败的是旧契约测试 |
| 15 | 旧邀请码有效期 | 新逻辑下 **expiresAt 必填**：无 expiresAt 的邀请一律视为无效；本地镜像 joinLocal 同步补过期校验（services/family.js L146-L157） | 无存量数据，放弃设计稿 L100"无 expiresAt 永不过期"口径 |
| 16 | lint/测试覆盖边界 | B3（cloudfunctions 纳入 Jest）、B6（cloudfunctions/scripts 纳入 eslint 独立配置）作为本期护栏一并做；现有 12 error/34 warning 只建台账、不夹带修复 | 云端权限代码不能继续处于零自动化护栏状态 |

## 4. 决策对实施计划（file-impact-list.md）的修订

### 4.1 权限模型（修订 A0）

- scope 最终结构：`{ key, title, meta, read, write, remind }`，四个 key 不变（bloodPressure/bloodGlucose/medicine/report）。
  - read：可见该块数据（homeFamily 及未来家属态二级页）；
  - write：bloodPressure/bloodGlucose 两块对应代录；medicine 对应代确认（已服/跳过）与撤销**本次代确认**；medicine 的计划增删改、所有记录删除**不受 write 控制，永不向家属开放**；
  - remind：可见该块的提醒类状态 + 显示"电话提醒"按钮（号码仅在任一 scope.remind=true 时返回）。
- **不写** enabled 兼容分支；归一化对缺失字段一律按 false（默认最小授权），非法/未知 key 拒绝落库（白名单）。
- noticeRules 保留三维 missedMedicine/missingRecord/weeklyReport，语义改为"该类提醒是否对家属可见/可电话提醒"；删除 missedNotice（getFamilyInviteData family-service.js L296-L301 移除，wxml 循环自然变为 4 项）。
- 关系扩为第 1 节 8 种，同步 index.js L528-L535、services/family.js L33-L41、family.test.js 关系用例。

### 4.2 绑定模型（修订 A1）

- joinFamilyByInvite 增加 **1:1 拦截**：family_members 已存在 `{memberOpenId: 本人, status:'active'}` 且 ownerOpenId 不同 → 拒绝（文案"你已绑定一位家人，请先解除原绑定"）；同一 owner 重复加入 → 幂等放行。
- getFamilyAccessContext 的 limit 1（index.js L621-L628）在 1:1 约束下语义正确，保留。
- family_auth **保留 owner 单文档**作为"当前邀请/预览配置"载体（不改为一邀请一文档，改动最小），但必须修：
  - createFamilyInvite 重新生成时**显式清空 memberOpenId、status 置 pending**（消除 family-service.js L539-L560 的残留）；
  - updateFamilyAuth **memberId 必填**，消除 L476-L502 批量更新；memberId 与关系行不匹配时报错而非静默；
  - revokeFamilyMember 无 memberId 分支补齐 family_members 处理（或直接拒绝空 memberId），保证撤销后 getFamilyAccessContext 立即返回 null；
  - 成员级 scopes/noticeRules 以 family_members 行为准；owner 可同时持有多位 active 家属（1:N）。
- 注销连带（settings-data-service.js L175-L189、L674-L725）：家属注销只撤/删**本人那条关系行**；owner family_auth 文档不再因单个家属注销整体 revoked（改为：仅当被撤的是当前 pending/active 邀请对应人时才复位文档状态）。

### 4.3 remind 重定义（替换原 A6）

- **不做**：sendDueReminders 家属分支、家属端 requestSubscribeMessage、新订阅模板、家属推送配额。sendDueReminders 维持"只推 owner 本人"现状，本期零改动（相关增强移入 C 类 backlog）。
- **要做（新 A6'）**：
  1. family_auth/family_members 增加 `contactPhone` 字段（owner 手填，邀请页与 family-auth 页可编辑；Schema member 子结构已有 phone 字段 L265，可复用/对齐命名）；
  2. getHomeFamilyData/getFamilyAuthData 按 remind 决定是否回传号码（脱敏字段 + 完整号码分两个字段，完整号码仅在点击拨号时按需由接口返回，**推荐**：接口只在 remind=true 时返回完整号码、前端不持久化）；
  3. home-family 增加"电话提醒"按钮 → `wx.makePhoneCall({ phoneNumber })`；无号码或 remind=false 时隐藏；
  4. 邀请页/授权页增加授权勾选与文案（"同意向家属展示该电话号码用于健康提醒联系，可随时修改或关闭"），static-pages 家庭共享条款（L88-L92、L164-L167）补充电话用途；
  5. family-auth noticeRules 三开关保留并接上述可见性语义。

### 4.4 其余阶段顺序（更新后）

```
B1 修回归 L295（todayLogs→todayCards）→ B2 停止复制逻辑 → B4 更新趋势契约测试
→ A-1 Node18 测试环境升级并回归（独立部署）
→ A0 三级模型/8 关系/白名单/删 missedNotice（无兼容分支）
→ A1 1:1 拦截 + family_auth 四项修复 + 注销连带修正
→ A2 邀请流程（显式生成、错码显式报错、attempts 频控、expiresAt 必填）
→ A3 二级页家属态 read 闭环（服务端鉴权 + 前端只读态）
→ A4 代录 write 闭环（BP/BG/代确认；计划与删除不开放；createdByMemberOpenId 审计）
        └─ 开工前必须先在测试环境验证云函数写入时 _openid 归属规则（技术验证点，见下）
→ A5 撤销实时生效、本地镜像过期/精确撤销、stale 缓存 TTL
→ A6' 电话提醒（contactPhone + makePhoneCall + 授权文案）
→ A7 Tab 放开、删除死页、回滚开关（远程云配置）、合规文案复核
→ 控制台清单：安全规则核查、inviteCode 唯一索引、attempts TTL 索引、集合创建、云函数部署
```

### 4.5 仍存在的技术验证点（非业务决策，A4 前必须实测）

- 云函数中以家属 openId 调用、add 文档时 `_openid` 的平台写入规则：若不能显式写 owner 的 _openid，则代录数据使用业务字段 `ownerOpenId` 归属、`createdByMemberOpenId` 记录代录人，并改造对应查询；两种方案在 A4 开工时用最小 demo 在测试环境验证后定稿。
- 微信云调用 event.userInfo.openId 注入可靠性（P0-1）随 A-1/A0 在测试环境日志核验。

## 5. 控制台/部署侧待办（代码无法代替，实施阶段需用户在腾讯云 CloudBase 控制台配合）

1. family_auth.inviteCode sparse 唯一索引；
2. family_invite_attempts 集合创建 + createdAt TTL 索引（24h）；
3. family_members / family_auth / family_invite_attempts 安全规则核查（初始化清单 L37 要求仅云函数读写）；
4. 云函数运行时 Nodejs18.15 切换（先测试环境）；
5. 云函数与小程序分包分别部署（project.config.json L71 忽略 cloudfunctions）。

> 用户消息中附带了腾讯云 CloudBase 插件入口；后续控制台类操作若可通过该插件/CloudBase CLI 完成，可在实施阶段再核对授权方式，本阶段不发起任何云端写操作。
