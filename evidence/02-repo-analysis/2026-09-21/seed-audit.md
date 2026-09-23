# 阶段 2・当前仓库只读审计：家庭权限调用链与验证缺口（seed-audit）



* 审计日期：2026-09-21

* 项目：康小记微信小程序（AppID `wxcb641f745311f6fb`），仓库根 `xiaochengxu/`

* 分支 / HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`（审计开始与结束时两次 `git status --porcelain` 一致：仅未跟踪项 `docs/家庭Tab开放与三级权限只读分析.md`、`evidence/`，无已跟踪文件改动）

* 审计方式：全流程只读。未修改业务代码 / 测试 / 依赖 / 配置，未切分支、未提交、未清理、未部署、未启动微信开发者工具。

* 基线：`evidence/00-baseline/2026-09-21/`（Node v22.23.2 /npm 10.9.8 会话环境下复跑，test/lint/regression 三检查结果见该目录）

* 线索材料：`docs/家庭Tab开放与三级权限只读分析.md`（2026-08-11，下称 "旧报告"）；`qa/designs/P2-4-family-permission.md`、`qa/tasks/P2-4-family-permission.md`（设计 / 任务稿）

* 模型身份：豆包工作界面实际所选模型**待人工留图确认**，本报告不以模型自报身份为证明。

* 阅读范围：`app.js`、`app.json`、`utils/`（api、api-config、routes、pre-check、route-guard、page-factory 相关）、`services/`（core、family、page-data、data-rights、medication-merge、medication）、`pages/family/`、`pages/family-sub/` 全部页面、`cloudfunctions/healthApi/`（index、family-service、record-service、report-service、medication-service、settings-data-service、static-pages）、`cloudfunctions/sendDueReminders/`（index、config.json）、`scripts/health-api-regression.js`、`tests/unit/`、`docs/`、`qa/`、`cloudbaserc.json`、`project.config.json`、`package.json`。跳过 `node_modules` 与构建产物，未读取任何密钥配置。



***

## 0. 一句话结论

家庭协同的 "邀请 — 加入 — 受控读首页" 链路在云端**已存在且以&#x20;**`family_members`**&#x20;为可信关系源**，但：① 家庭 Tab 被有意的前端占位开关关闭，真实 UI 整段注释；② 权限模型只有 `enabled` 两级，设计稿的 `read/write/remind` 三级**零落地**；③ 受控跨账号读**只有&#x20;**`homeFamily`**&#x20;一个接口**，家属从该页跳进趋势 / 记录 / 用药二级页后数据主体立刻断裂（看到本人空数据）；④ **不存在任何家属写（代录）通道**；⑤ 改权 / 撤销 / 反复邀请在多成员场景下存在已验证的误伤与残留访问路径；⑥ `remind` 只有字段与开关，定时推送只发给本人，家属推送不存在。



***

## 1. 当前家庭功能全景与调用链

### 1.1 入口可达性（当前 UI 实际能走到哪里）



| 入口                     | 代码位置                                                                                                                  | 当前是否可达                                                                                                                                   | 说明                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| tabBar「家庭」Tab          | `app.json` L6（页面）、L102-L105（tabBar 项）                                                                                 | **可达**                                                                                                                                   | 打开后是占位页                                          |
| 家庭 Tab 占位              | `pages/family/index.wxml` L14 注释、L15-L20 `<coming-soon>`                                                              | **可见**                                                                                                                                   | 文案 "家庭协同… 开发中"；真实 UI 在 L21-L78 被 `<!-- -->` 整段注释 |
| 角色选择 "帮家人管理" → 加入提示    | `pages/settings/role/index.js` L67 附近 `goRoute('familyJoinHint')`；`utils/pre-check.js` L242-L243 对 join-hint/join 免资料 | **可达**（家属角色引导）                                                                                                                           | family-join-hint 为静态说明，引导拿邀请码                    |
| 隐私设置页 "家属授权管理" 项       | `cloudfunctions/healthApi/static-pages.js` L14（授权设置静态项，route `family`）                                                | **可达**，但只跳到占位 Tab                                                                                                                        | 云端静态配置，页面渲染于设置相关页                                |
| 邀请页 family-invite      | `pages/family-sub/family-invite/index.js`；路由 `utils/routes.js` L33                                                    | **不可达**：唯一入口是家庭页注释块中的 "邀请家属" 按钮（`pages/family/index.js` L73-L75），按钮在注释 UI 内                                                              |                                                  |
| 加入页 family-join        | `pages/family-sub/family-join/index.js`；routes L34                                                                    | **半可达**：可由分享卡片 `pages/family-sub/family-join/index?inviteCode=...`（family-invite 分享 path，`family-invite/index.js` L45）进入；无邀请码也能打开（展示通用页） |                                                  |
| 授权管理 family-auth       | routes L36                                                                                                            | **不可达**：仅家庭页注释块 `manageMember`（`pages/family/index.js` L89-L92，带 `?id=`）进入                                                               |                                                  |
| 家属首页 home-family       | routes L37                                                                                                            | **不可达（正常路径）**：加入成功后 `goRoute('homeFamily')`（family-join L89）与家庭页 "家属视角" 按钮（family/index.js L81-L83）是仅有的两个入口，前者依赖邀请页能被打开，后者在注释块内          |                                                  |
| 分包中转页 family-sub/index | `app.json` L52 注册 `"index"`；`pages/family-sub/index.js` L12-L22 仅 3 个 `safeNavigateTo` 按钮                             | **死页**：`utils/routes.js` L33-L37 无对应路由键，全仓 grep 无任何页面跳转它                                                                                 |                                                  |

结论：**当前线上版本家属侧唯一自然入口是 "角色选择→加入提示"，但拿不到邀请码（邀请页不可达），整条家庭协同链路对真实用户处于关闭状态；云函数接口已全部部署可调（见 1.4 风险面）。**

### 1.2 前端调用链（页面 → 门面 → services → 云）



* 页面统一从 `utils/api.js` 取接口，不直接访问 services（与 `docs/项目结构阅读指南.md` L171 描述一致）。

* 家庭读接口导出：`utils/api.js` L335-L338（family/invite/join/auth）、L322（joinHint）、L325/L257-L262（homeFamily）；写接口 L356-L359（updateFamilyAuth/createFamilyInvite/joinFamilyByInvite/revokeFamilyMember）。

* `getHomeFamilyData` 是唯一带前端后处理的家庭读链路（`utils/api.js` L257-L262）：

1. `resolveMockData('homeFamily')`（cloud 模式即 `requestCloudByKey('homeFamily')`，`services/core.js`）；

2. `.then(family.enforceHomeFamilyAccess)`（`services/family.js` L202-L210）；

3. `.then(medication.mergeHomeFamilyMedicationStatus)`（`services/medication-merge.js` L237-L256）。

* services 层：`services/family.js` 负责本地镜像与归一化；四个写操作经 `resolveRemote(action, payload, localHandler, { mirrorLocal: true })` 在云端成功后镜像写本地 `family_auth_v1`（`services/family.js` L320-L342）。

* 数据源：`utils/api-config.js` L9 `dataSource: 'cloud'`、L10 `cloudFunctionName: 'healthApi'`；云初始化 `app.js` L36-L40（env `kangxiaoji-d5gw2k203f0488a9e`、`traceUser: true`），与 `cloudbaserc.json` L2 一致。

### 1.3 云端读链路（唯一受控跨账号读：homeFamily）



```
wx.cloud.callFunction（services/core.js L161-L162，前端不传 userInfo）

&#x20; → healthApi exports.main（cloudfunctions/healthApi/index.js L1285）

&#x20; → getOpenId(event)：event.userInfo.openId（index.js L208-L214；除 rebuildRecordStats L1291-L1296 外，缺失即抛错 L1289-L1297）

&#x20; → keyMap\['homeFamily'] → getFamilyService().getHomeFamilyData(openId)（index.js L1331 附近；familyJoin 见 L1344）

&#x20; → getFamilyAccessContext(openId)（index.js L620-L659）：

&#x20;     ① 先查 family\_members：{ memberOpenId: openId, status:'active' } orderBy updatedAt desc limit 1（L621-L628）

&#x20;        → 命中：mode='member'，ownerOpenId=关系行的 ownerOpenId（L630-L636）

&#x20;     ② 否则查 family\_auth：{ \_openid: openId } limit 1（L639-L642）

&#x20;        → 无文档或 status='revoked' → null（L645）

&#x20;        → 否则 mode='ownerPreview'，ownerOpenId=本人（L646-L658，注释 L638 明确"本人预览家属视角，不跨账号"）

&#x20; → getHomeFamilyData（family-service.js L32-L172）：

&#x20;     按关系 scopes 逐项判定（L56-L59，isRelationScopeEnabled 兼容 bp/bloodPressure、bg/bloodGlucose、med/medicine、report 别名）

&#x20;     → health\_records：where { \_openid: ownerOpenId, type: \_.in(allowedTypes) }（L80）

&#x20;     → medication\_plans：where { \_openid: ownerOpenId, status:'启用' }（L101）

&#x20;     → medication\_confirmations：where { \_openid: ownerOpenId, confirmDate: 今日 }（L113）

&#x20;     → ownerName 回查 profiles（L70、getProfileDisplayName index.js L607-L613）
```

受控读只做了 "字段块级过滤"（血压 / 血糖 / 用药 / 周报四块开关），不做行级、时间范围级过滤。

### 1.4 云端写 / 关系管理链路



| 动作     | 云函数（family-service.js 除注明外）                                                                                                                                                                                   | 关键行为与行号                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 创建邀请   | `createFamilyInvite(openId, payload)` L520-L589                                                                                                                                                               | 查 owner 的 family\_auth limit 1（L534）；存在即 `doc().update`、不存在即 add，**owner 维度单文档 upsert**；inviteData 含新 `inviteCode`、`status:'pending'`、`expiresAt=now+24h`（L549）、scopes/noticeRules；**inviteData 不含 memberOpenId，update 为合并语义，旧 memberOpenId 残留**（L539-L560）          |
| 查询加入信息 | `getFamilyJoinData(payload)` L311-L372                                                                                                                                                                        | 仅凭 inviteCode 查 family\_auth（L316-L330）；**查无此码 / 空码时不报错，返回通用默认加入页**（默认 scopes、remainHours 24，L359-L371）；有码则返回 ownerName（L335-L340）、remainHours（L341-L342）、scopes；**不校验 status（revoked 的邀请在加入页仍可展示，只在真正加入时拦截）**                                                       |
| 加入     | `joinFamilyByInvite(openId, payload)` L591-L695                                                                                                                                                               | 校验：不存在 L603-L605、已撤销 L606-L608、active 且 memberOpenId 是他人 L609-L611、过期（仅当 expiresAt 存在）L612-L614、不能加自己 L617-L619；按 {ownerOpenId, memberOpenId} upsert family\_members（L635-L638、L643-L690 区段），并把 family\_auth 置 active、写 memberOpenId（L680、L691-L692 附近）              |
| 改权限    | `updateFamilyAuth(openId, payload)` L445-L518                                                                                                                                                                 | 先更新 owner 的 family\_auth 单文档（L456-L468）；再同步 family\_members：**有 memberId 时按&#x20;**`{_id:memberId, ownerOpenId, status:'active'}`**&#x20;精确定位（L470-L475）；无 memberId 时 where 退化为&#x20;**`{ownerOpenId, status:'active'}`**，批量改该 owner 名下所有家属（L476-L502）**             |
| 撤销     | `revokeFamilyMember(openId, payload)` L697-L788                                                                                                                                                               | 有 memberId：校验 `{_id:memberId, ownerOpenId:openId}`（L706-L712，不存在抛错 L723-L725），把该 family\_members 置 revoked（L729-L734）；**仅当 family\_auth.memberOpenId 恰好等于该成员时才同步撤 family\_auth（L737-L745）**。无 memberId（L759-L782）：**只撤 owner 的 family\_auth，一条 family\_members 都不碰** |
| 健康数据写  | index.js `saveBloodPressureRecord` L1162-L1181（`_openid: openId` L1171）、`saveBloodGlucoseRecord` L1195-L1214（L1204）、`deleteRecord` L1260-L1275（`assertOwnedDocument` L1265，定义 L588-L595）                      | 全部以调用者本人为数据归属，**无 ownerOpenId 入参、无家属写鉴权**                                                                                                                                                                                                                            |
| 用药写    | medication-service.js `saveMedicationPlan` L324（新增 `_openid: openId` L352，更新走本人归属校验 L183/L225-L226）、`confirmMedication` L383-L432（查询 L393、写入 `_openid: openId` L420）、`revokeMedicationConfirmation` L434-L441 | 同上，**无代确认 / 代录通道**                                                                                                                                                                                                                                                   |

### 1.5 身份、数据所有者、成员关系、权限的可信来源



* **调用者身份**：云函数取 `event.userInfo.openId`（index.js L208-L214）。前端 `wx.cloud.callFunction` 只传 `{name, data}`（`services/core.js` L161-L162），不自行构造 userInfo—— 即身份依赖微信云调用平台注入，客户端常规途径无法伪造。**运行时是否确实注入、是否有其他调用端（HTTP 触发 / 管理端）可绕过，属待运行验证项**（关联任务稿 P0-1 云函数身份验证，`qa/tasks/P2-4-...md` L25）。

* **数据所有者**：健康数据集合以记录内 `_openid` 为归属（record-service /report-service/medication-service 全部查询硬编码 `_openid: openId`，grep 三文件无任何 `family/ownerOpenId/memberOpenId` 字样）。

* **成员关系可信源**：`family_members`（ownerOpenId + memberOpenId + status + scopes），仅云函数读写；`docs/云开发控制台初始化清单.md` L37 明确该集合 "不应允许小程序端直接读写，统一通过 healthApi 云函数校验"。

* `family_auth`**&#x20;的角色**：owner 维度的邀请 / 授权单文档（邀请码、scopes、noticeRules、memberOpenId 冗余），既是邀请载体又承担 ownerPreview 配置；与 family\_members 是 "一份邀请文档 + N 条关系行" 的双写模型。

* **权限判定**：云端 `isScopeEnabled`（index.js L552-L555）、`isRelationScopeEnabled`（L563-L565）、`getScopeText`（L572-L578）**只认&#x20;**`scope.enabled`；本地同名函数 `services/family.js` L43-L47 同样只认 enabled。

* **本地 storage 不是权限源**：`enforceHomeFamilyAccess`（services/family.js L202-L210）只读本地 `family_auth_v1`；真实拦截在云端（关系不存在时 getHomeFamilyData 返回无授权结构）。本地层可被客户端篡改，只能当镜像 / 兜底，不能当授权依据 —— 旧报告此判断成立。

### 1.6 数据库集合



* 云函数常量 `COLLECTIONS`（index.js L41-L53）：health\_records、medication\_plans、medication\_confirmations、family\_auth、family\_members、reminder\_settings、privacy\_settings、feedbacks、health\_daily\_stats、health\_record\_stats、profiles（11 个）。

* 定时函数另用 `reminder_push_logs`（sendDueReminders/index.js L25），不在 healthApi 的 COLLECTIONS 常量内。

* 初始化清单（`docs/云开发控制台初始化清单.md` L16-L19）把 family\_members、health\_daily\_stats、health\_record\_stats、reminder\_push\_logs 列为 "新增集合"，**family\_auth 不在新增清单（假设此前已建）**；仓库内不含数据库安全规则文件（grep/glob 未发现 permission/rules 配置），**线上集合权限配置待人工在云控制台核对**。

* Schema 文档对邀请码唯一性的表述仅为 "后续加入家庭时需要唯一约束"（`docs/云开发数据库Schema设计文档.md` L251），代码与清单中均未见唯一索引创建逻辑；**索引是否已在线上建立待人工确认**。

### 1.7 本地镜像与缓存



* 持久化镜像：四个 Local 镜像函数写 `wx.storage` 的 `family_auth_v1`（STORAGE\_KEYS.familyAuth，services/core.js L22 附近）：


  * `updateFamilyAuthLocal` L73-L107；`createFamilyInviteLocal` L109-L144（**本地邀请无 expiresAt**，L124-L135）；`joinFamilyByInviteLocal` L146-L157（**本地加入无有效期校验**）；`revokeFamilyMemberLocal` L159-L183（**无 memberId 时用&#x20;**`currentMembers.slice(1)`**&#x20;兜底** L163-L165，删谁取决于数组顺序，语义不可靠）。

  * 镜像只在云端 action 成功后执行（mirrorLocal，L320-L342）；云端失败不会用本地结果冒充成功。

* 云读缓存（内存态）：`cloudReadCache = {}`（core.js L22）、TTL 60s（L24 `CLOUD_READ_CACHE_TTL_MS=60000`）；写 action 成功后**清空全部云读缓存**（L192-L196，`clearCloudReadCache()` L94-L96）—— 粒度粗但安全方向正确；**失败路径不清缓存**。

* 失败兜底：`requestCloudByKey` catch 时以 `allowStale=true` 取缓存（core.js L237-L239 附近），该分支**不校验 TTL**，云端持续失败时可返回任意旧的内存数据（缓存随进程死亡，不持久化）。

* 脏页联动：familyAuth 变更标记 family/home/homeFamily 三页脏（DIRTY\_MAP core.js L32；getRelatedCacheKeys L121）。

* 显示串扰（本轮新发现，待运行验证）：`mergeHomeFamilyMedicationStatus`（medication-merge.js L237-L256）会把**家属本机自己最新一条用药确认**按 logId 匹配覆盖到 home-family 返回的 owner `medicineLogs` 卡片状态上（api.js L261 串联）。若家属本人计划与 owner 计划生成了相同 logId（logId 由计划 id + 时点构造），owner 卡片可能显示家属自己的 "已服 / 跳过" 状态。仅显示层、家属看到的本就是本机数据，不构成跨账号泄露，但会造成状态错显。

* 注销 / 导出 / 删除联动（settings-data-service.js）：


  * `clearUserAccount` L674-L725：删本人 \_openid 的 family\_auth、按 ownerOpenId 与 memberOpenId 两个方向删 family\_members（L697-L699 附近），并调 `updateFamilyAuthByMember`（定义 L175-L189）把 memberOpenId = 本人的 family\_auth 置 revoked；

  * `exportUserData` L592-L646：双向导出 family\_auth/family\_members；

  * `deleteUserData` L648-L672：只删健康 / 用药数据，不动家庭关系。

  * 待注意（设计层面）：家属注销会把 owner 的 family\_auth 单文档置 revoked，即使该 owner 还有其他 active 家属（关系行仍在，但 ownerPreview / 邀请文档状态被整体改写）—— 多家属单文档模型的连带效应，列入实施计划风险项。

### 1.8 remind（提醒）链路现状



* 字段层：`noticeRules` 三维（missedMedicine/missingRecord/weeklyReport，默认值 index.js L387-L408），邀请默认值、family\_auth 与 family\_members 双写、family-auth 页开关（family-auth/index.js L81-L92、wxml 提醒区块）均已贯通。

* **但没有任何消费方**：全仓 grep `noticeRules`，除 family-service 存取、family-auth 页面开关、文档外，定时函数 `sendDueReminders` **完全不读 noticeRules、不查 family\_members**。

* 定时推送现状（cloudfunctions/sendDueReminders/index.js）：


  * 触发器 config.json L6：`"0 * * * * * *"`（7 字段 cron，每分钟第 0 秒）；

  * 扫描对象 = owner 本人：用药计划 `_openid` 去重（L360-L372）+ reminder\_settings `_openid`（L374-L385），合并去重 L387-L394；

  * 对每个 openId 跑 processMedicine/measure/weeklyReport（L349-L358、L284/L328/L338），`sendSubscribeMessage` 的 `touser` 就是该 openId 本人（L138-L142）；

  * 模板仅 3 个：medicine /measure/weeklyReport（L28-L36）；无 "漏服通知家属" 模板；

  * 推送去重写 reminder\_push\_logs（L25、L75-L117）。

* 订阅授权：前端经 `wx.requestSubscribeMessage` 取得授权、本地记配额（utils/subscribe.js）；云端发送不依赖本地配额，直接调 openapi 并记录不可重试失败。**家属端没有任何订阅授权入口页面**（家属不可达 reminder 页，reminder 相关页面在 PROTECTED 列表且按本人数据渲染）。

* 结论：**三级权限中的 remind 当前完成度 = 0%（无家属收件人、无家属订阅入口、无漏服模板、noticeRules 是死开关）**；missedMedicine/missingRecord/weeklyReport 语义上是 "提醒家属"，但实现上全部只发给 owner 本人。



***

## 2. 八个审计问题逐项结论

### Q1 家庭 Tab 的占位状态及已有功能



* **结论：有意的前端开关，后端与页面 JS 已先行开发。**

* 证据：占位注释与 coming-soon（pages/family/index.wxml L14-L20），真实成员列表 / 邀请 / 预览 / 管理 / 解除 UI 注释于 L21-L78；页面 JS 逻辑完整（pages/family/index.js：loadData L29-L31、onShow 刷新 L50-L56、inviteFamily L73-L75、previewFamily L81-L83、manageMember L89-L92、revokeMember L98-L124、分享 L127-L143）。

* 云端 5 个读 key + 4 个写 action 均已在路由表注册（index.js keyMap L1323-L1354、actionMap L1364-L1385）。

* 已有功能（云端能力，非 UI 可达）：创建 / 查询 / 加入邀请、成员列表、授权改权、撤销、ownerPreview、受控首页聚合读、注销 / 导出联动。

### Q2 邀请、加入、查看、代录、修改权限、撤销的入口



* 邀请：UI 入口不可达（注释块）；云端 `createFamilyInvite` 可用。邀请页 onLoad 即创建一次（family-invite/index.js L29-L33），且切换关系 L50-L56、切换开关 L58-L68、全选 L70-L75 每次都再调 `createInvite`（L89-L104）——**一次配置过程会产生 N 次 upsert、N 个新邀请码，只有最后一个码有效**（family\_auth 单文档被反复覆盖，status 反复回 pending）。

* 加入：family-join 页 + 云端校验链完整（见 1.4）；加入成功跳 homeFamily（L89）。

* 查看：仅 homeFamily 受控（1.3）；二级页无家属态（见 Q5）。

* **代录：无任何入口与通道（前端无按钮、云端无 ownerOpenId 参数、无家属写鉴权），write 权限无承接点。**

* 修改权限：family-auth 页（不可达）+ `updateFamilyAuth`，存在无 memberId 批量误伤（见 Q6）。

* 撤销：家庭页 revokeMember 传 memberId（family/index.js L109，走安全分支）；family-auth 页 revokeAuth 传 `this.data.memberId`，**页面无 id 打开时该值为空串**（family-auth/index.js L19、L40、L143），走云端无 memberId 分支（见 Q6）。

### Q3 调用者身份、数据所有者、成员关系、权限的可信来源

见 1.5。要点：身份靠平台注入 openId（代码事实成立，运行时注入待验证）；关系可信源是 family\_members；family\_auth 是 owner 单文档邀请 / 配置；本地 storage 不可作为授权依据；`getFamilyAccessContext` 对 "一个家属关联多个 owner" 只取 `updatedAt` 最新的一条（index.js L621-L628，limit 1）——**多 owner 场景家属只能看到最近关联的一位老人，无切换入口，其余关系虽 active 但不可达**。

### Q4 enabled 与 read/write/remind 的实际代码与设计差异



* 代码现状（已验证）：scope 对象全链路只有 `{key,title,meta,enabled}`：默认 4 项（index.js L354-L381）、邀请页返回 5 项（family-service.js L271-L302，多一个 missedNotice，L296-L301）、鉴权与文案只认 enabled（index.js L552-L578、services/family.js L43-L47）、邀请归一化只校验 "至少一个 enabled"（normalizeFamilyInvitePayload L834-L854 附近）、family-invite/family-auth 的 wxml 全是二值 switch。

* 设计稿（未实现）：三级结构 `{read,write,remind}`（qa/designs/P2-4 L15-L22）、旧数据映射 enabled=true→read:true,write:false,remind:true（L24-L27、L99-L102）、`hasScopePermission` 草稿（L76-L94）、8 种关系（L34-L43，任务验收要求 ≥7，qa/tasks/P2-4 L15）、本地 expiresAt 校验（L49-L70）、featureFlags 回滚（L104-L108）。

* **运行时代码中不存在 featureFlags 机制**（全仓 grep 仅 qa 文档命中），设计稿的回滚开关无基础设施。

* 边界混乱（已验证）：`missedNotice`（"未确认提醒"）被 getFamilyInviteData 当作第 5 个 scope 返回（family-service.js L296-L301），而 normalizeFamilyInvitePayload 对 scopes 只按 "有 key" 过滤、无 key 白名单（index.js L834-L854），客户端可把任意 key 的对象当 scope 落库；同类概念 noticeRules 又是独立三维（L387-L408）。模型边界需在开发前厘清。

* 关系类型仅 4 种（index.js L528-L535、services/family.js L34-L39：daughter/son/spouse/other），不满足验收 1 的 ≥7 种。

### Q5 家属进入趋势、记录、详情等二级页后是否仍访问正确数据主体



* **不会。数据主体在离开 homeFamily 后立即断裂。**

* home-family 页所有出口都不带 owner 上下文：快捷入口 `goRoute(event.detail.route)`（home-family/index.js L71-L73，wxml 中 route 为 trend/medList）、指标卡 L80-L82（route 为 recordDetail）、用药卡 L89-L95（medConfirm/medList）、按钮 L103-L105（medConfirm）、L108-L110（recordList）、L113-L115（trend）。

* 目标服务全部硬编码 `_openid: 本人`：record-service.js、report-service.js 经 grep 无 family/ownerOpenId/memberOpenId 任何字样；medication-service.js 同类查询 L41/L51/L183/L225-L226/L244。

* 现象：家属点进趋势 / 记录 / 用药，看到的是**本人账号的空数据或本人数据**，不是 owner 的 —— 性质是 "漏权 + 数据主体混淆"（看不到 owner），而不是 "越权读到 owner"。但这与用户对 "家属查看" 的预期直接冲突，且二级页里的记录 / 确认按钮指向家属本人数据，开放后极易误操作。

### Q6 多邀请、多成员、权限更新、撤销的覆盖 / 误操作风险

以下均为代码已验证事实：



1. **反复邀请覆盖**：createFamilyInvite 对 owner 的 family\_auth 单文档 upsert（family-service.js L534-L560），新码替换旧码、status 回 pending、expiresAt 重置；旧码立即失效（join 按 inviteCode 查仅一份文档）；update 合并语义使旧 memberOpenId 残留（inviteData 不含该字段，L539-L551）。对已加入成员的 family\_members 行**不直接改动**（其访问暂不受影响，access context 查 family\_members），但 ownerPreview、授权页展示与 "一个邀请只绑一位家属" 的语义被重置。

2. **改权批量误伤（高危）**：updateFamilyAuth 无 memberId 时 `where {ownerOpenId, status:'active'}` 批量更新该 owner 全部家属的 scopes/noticeRules（family-service.js L476-L502）。可达路径：family-auth 页无 id 打开（onLoad `memberId: options.id || ''`，family-auth/index.js L39-L41；saveAuth 原样上送 L109-L115）。当前该页只能从注释块带 id 进入，但云 action 已上线，任何客户端可直接调 action。

3. **撤销残留访问（高危）**：revokeFamilyMember 无 memberId 分支只改 family\_auth（L759-L782），不碰 family\_members；而 getFamilyAccessContext 先查 family\_members（index.js L621-L636）——**撤销后家属关系行仍 active，homeFamily 仍可读到 owner 数据**。可达路径：family-auth 页空 memberId 点解除（family-auth/index.js L143）。

4. 有 memberId 的撤销分支本身正确（校验 ownerOpenId、关系行置 revoked，L700-L756），但 family\_auth 同步条件是 "文档 memberOpenId 恰好等于该成员"（L737）；多成员场景下旧成员本来就不持有 family\_auth 文档，不同步是对的；要注意的是该分支不会清理其他成员的状态。

5. **家属关联多 owner 只认最新**：getFamilyAccessContext limit 1（index.js L621-L628），无 owner 切换机制（见 Q3）。

6. 邀请枚举面：familyJoin 路由虽然在 main 入口仍要求登录态（index.js L1289-L1297，旧报告 "无需登录态" 表述需修正，见 inconsistency-review），但 service 不校验调用者与邀请关系，**任意已登录用户持码即可拿到 ownerName + scopes + 剩余有效期**（family-service.js L311-L342）；错码不报错而返回通用页（L359-L371），无法区分 "码无效" 与 "码有效"；无尝试次数限制、无服务端唯一索引证据。邀请码实际为 `KXJ` + 4 位时间 base36 + 5 位随机 base36，共 12 字符（createInviteCode index.js L239-L243），随机空间 36^5 ≈ 6×10^7，且与创建时间强相关。

7. 注销连带：家属注销会把 owner 的 family\_auth 整体置 revoked（settings-data-service.js L175-L189、L697-L717 区段），多家属下影响面偏大（见 1.7）。

### Q7 本地镜像 / 缓存残留失效数据或操作能力



* **数据残留（中危）**：云端撤销 / 改权发生在 owner 设备或另一台家属设备时，本台家属设备的 `family_auth_v1` 不会被主动通知失效；下次 homeFamily 请求成功时云端是权威（撤销即返回无授权），但：


  * 云端请求**失败**时，内存云读缓存 allowStale 兜底不校验 TTL（core.js L237-L239），可在当次进程内持续看到旧的 owner 聚合数据；

  * `enforceHomeFamilyAccess` 只在本地镜像明确 revoked / 空时遮罩（family.js L202-L210），云端已撤、本地镜像仍 active 时它不拦截；

  * 本地镜像无过期概念（createFamilyInviteLocal 无 expiresAt、joinLocal 不校验过期，family.js L124-L135、L146-L157），cloud 模式下仅作镜像，但一旦切 local 模式或云端不可用，会暴露 "永不过期的本地邀请"。

* **操作能力残留**：二级页（趋势 / 记录 / 用药）本就不校验家庭关系，家属在这些页面的记录 / 确认动作始终写到本人名下 —— 撤销家庭授权不会、也无法收回这些页面上的任何操作（它们从未属于 owner）。代录上线时若仅在前端隐藏按钮而无云端鉴权，旧版本小程序 / 直接调 action 仍可写。

* 缓解现状：写成功清全部读缓存（core.js L194）、familyAuth 脏页联动（L32/L121）、云端关系查询是权威 —— 方向正确，但撤销的 "即时生效" 在弱网 / 离线 / 旧客户端下没有强保证。

### Q8 remind 实现程度与依赖条件

见 1.8。总结：



* 已实现：owner 给自己的用药 / 测量 / 周报订阅消息定时推送、推送去重、前端订阅授权与本地配额、noticeRules 字段双写与 UI 开关（开关无效果）。

* 未实现（三级 remind 所需）：① 扫描 family\_members active 且该 scope remind=true 的家属；② 向 memberOpenId 推送的分支；③ 漏服 / 未记录类家属模板（现仅 3 个 owner 模板，sendDueReminders L28-L36）；④ 家属端 requestSubscribeMessage 授权入口（家属无 reminder 页面可达路径）；⑤ noticeRules 与 scopes.remind 的双重判定；⑥ 配额管理（家属订阅份数存哪个集合、如何按 memberOpenId 记账）。

* 依赖的云端 / 平台条件：新订阅消息模板需在微信公众平台申请并过审；家属必须在小程序内完成一次订阅授权交互（微信能力限制，无法静默代授权）；定时函数配额与云函数部署（cloudbaserc 运行时仍为 Nodejs16.13，cloudbaserc.json L11/L21）。



***

## 3. 验证缺口分析（只分析，不修复）

### 3.1 两个趋势页失败测试是否影响家庭读路径



* 失败事实（evidence/00-baseline/2026-09-21/test.txt L568-L611）：`tests/unit/page-data-consistency.test.js` 两个断言失败 ——


  * L36/L38 期望 `trend.metricOptions` 长度 3 且为 `['bloodPressure','bloodGlucose','medication']`，实际 2 项 `[bpBg, medication]`（test.txt L580-L592）；

  * L50 期望 `trend.activeMetric === 'bloodPressure'`，实际 `'bpBg'`（L596-L608）。

* 对家庭读路径的影响：**无直接影响**。该测试校验的是本地默认页数据 `DEFAULT_PAGE_DATA.trend`（services/page-data.js），homeFamily 走独立的云端聚合接口（family-service.js L32-L172）与独立默认结构（page-data.js L20 `homeFamily`），family.test.js 全部通过（test.txt L327-L355）。

* 间接影响：它证明趋势页已把血压 / 血糖合并为 `bpBg` 复合指标（云端 getTrendData 与单测其余用例已按 bpBg 实现，test.txt L67-L75 全过），**失败的是这份一致性测试的旧契约**。未来家属态趋势若复用 trend 页，预期须以 bpBg 复合指标为准，不能按旧的 bloodPressure 单指标设计。该测试契约以哪份为准（改测试还是改默认数据）属 B 类待决项。

### 3.2 回归脚本在用药用例提前退出，跳过了哪些用例



* 崩溃点：`scripts/health-api-regression.js` L295 读取 `list.todayLogs[0]`，而真实 `getMedListData` 现返回 `{ todayCards, plans, confirmations }`（medication-service /medication-merge 现结构，回归脚本 L231-L234 的 mock 期望值也是 todayCards）——**脚本断言字段停留在旧结构 todayLogs，属脚本与实现漂移**（regression.txt L3-L7，main 调用在 L523）。

* main 顺序（L521-L527 附近）：testPerfSchema → **testMedicationService（崩）** → testFamilyService → testSettingsDataService。

* 崩溃后未执行：


  * `testFamilyService`（L318-L430）：邀请创建→查询→加入→homeFamily 受控读的整条 happy path（含 scopes 过滤断言）；

  * `testSettingsDataService`（L432-L519）：提醒设置、隐私、反馈、数据管理、导出、删除、清空账号（含家庭集合双向清理）。

* 即：**云端家庭链路在当前 CI 形态下事实上零自动化执行**（Jest 不收 cloudfunctions 覆盖率，见 3.3），家庭权限改动目前没有任何能跑通的自动化护栏。

### 3.3 当前测试调用的是真实实现还是复制逻辑



* Jest（16 套件 / 357 用例）：全部 require `services/**`、`utils/**` 真实模块（逐文件核对 tests/unit 的 require），**不是复制逻辑**；但覆盖范围不含 cloudfunctions（package.json L23-L27 collectCoverageFrom 仅 services/utils），且 `npm test` 为 `jest --verbose`（L8），**未带 --coverage，coverageThreshold（L28-L35，branches 60/functions 70/lines 70/statements 70）在默认测试命令中不生效**。

* 回归脚本：require 的是**真实云端 service 模块**（scripts/health-api-regression.js L2-L5：medication-service、family-service、settings-data-service、perf），以内存 mock db 驱动 —— 主链路测的是真实实现；但：


  * mock db 的 where 匹配只支持等值与 `_.in`（L150-L157），不支持 gte/lte/and/neq/regex，趋势 / 统计等范围查询分支在该 harness 下不具备真实语义；

  * 默认值与校验器在脚本内**复制了一份**：getScopeText/isRelationScopeEnabled/getDefaultFamilyScopes/getDefaultNoticeRules/getDefaultInviteRelations（L172-L203）、normalizeFamilyAuthPayload/normalizeFamilyInvitePayload（testFamilyService 内联，约 L387-L406）、简化版 validate\*Payload（L212-L232）—— 与 index.js 真实实现是两份代码，三级权限改造时极易只改一处（旧报告此判断成立）。

  * mock 的 `where().remove()` 不按查询条件过滤（mock 实现仅按 docId 删，L81-L85 区段），凡按条件批量删的分支（如撤销确认、注销清理）在 harness 下断言不可靠。

* family.test.js 现状（L327-L355）：仅覆盖 normalizeMemberStatus/getRelationInitial/getRelationMeta/getScopeText/mapFamilyMember/enforceHomeFamilyAccess/getNoFamilyAccessData 纯函数；**四个本地镜像函数（update/create/join/revoke Local）零覆盖**。

### 3.4 身份、权限、数据归属、撤销场景的测试缺口清单



1. 安全断言缺失：无 "无 read scope 时 homeFamily 不返回对应字段 / 集合" 的断言（现 happy path 只断言全授权）；无 "家属调用 save\* 不能写 owner 数据" 的负向用例（write 通道上线前后都需要）。

2. 关系管理缺失：多成员下 updateFamilyAuth 精确定位 vs 无 memberId 批量更新的用例；revoke 有 / 无 memberId 两分支（特别是无 memberId 后 family\_members 仍 active 的现状应用例锁定，修复后防回归）；重复邀请覆盖、旧码失效、memberOpenId 残留；错误码 / 撤销码 / 过期码 / 自己码 / 他人 active 码的加入拒绝矩阵。

3. 多 owner：一个 memberOpenId 关联多个 owner 时 access context 的选择（当前 limit 1）。

4. 枚举面：getFamilyJoinData 错码返回通用页、ownerName 泄露面、频率限制（当前无限制，需先决定产品策略）。

5. 缓存 / 镜像：云端撤销后家属端失效时序、allowStale 无限 TTL 兜底、本地镜像 revoke 的 slice (1) 兜底、mirrorLocal 仅云端成功后写。

6. 注销 / 导出：家属注销对 owner family\_auth 的连带影响、双向导出字段完整性。

7. remind：未来家属推送的收件人选择、noticeRules×scopes.remind 双判定、家属订阅配额。

8. 二级页家属态：trend/recordList/recordDetail/medList/medConfirm 携带 ownerOpenId 后的读过滤与按钮禁用（当前完全无测试支点）。

9. lint 护栏缺口：eslint 只扫 services/utils/pages/components（package.json L11），**cloudfunctions、scripts、tests 不在 lint 范围**，云端权限代码风格 / 潜在错误无 lint 拦截。



***

## 4. 待确认的业务选择（不擅自扩大授权）



1. **代录范围**：仅允许 "代确认已服 / 跳过"？还是含血压 / 血糖代录？是否允许家属增删改用药计划？（当前三种通道都不存在；建议最小授权：代确认 + 血压血糖代录，用药计划只读，需拍板。）

2. **多家属数据模型**：维持 family\_auth owner 单文档（邀请 / 预览语义反复被覆盖），还是改为 "一邀请一文档" 或 "一成员一文档"？这决定 Q6 中 1/2/3/7 几个问题的修法。

3. **read 粒度**：维持四块（血压 / 血糖 / 用药 / 周报）开关，还是细化到字段 / 时间范围？三级结构中 read 是否还需要子粒度？

4. **remind 语义**：remind 是 "家属接收漏服 / 未记录 / 周报通知" 的总闸、noticeRules 是类型开关（设计稿口径），还是另有定义？家属端订阅授权入口放在哪个页面？是否申请新模板？

5. **missedNotice 归属**：并入 noticeRules（建议）还是保留为独立 scope？

6. **关系类型清单**：验收要求 ≥7 种（设计稿列孙女 / 孙子 / 兄弟姐妹 / 护工等 8 种，qa/designs/P2-4 L34-L43），最终名单与角色文案需确认。

7. **旧数据兼容**：线上 family\_auth/family\_members 是否已有真实数据、量级多少（仓库无迁移脚本 / 快照，**需云控制台核查**）；enabled→三级映射按设计稿 read+remind、write=false 是否符合预期；是否需要一次性 backfill。

8. **死页 family-sub/index**：删除还是接入 routes。

9. **邀请安全策略**：错码是否要改为显式报错、是否加尝试频率限制、是否上唯一索引（Schema L251 仅 "后续应唯一"）。

10. **运行时版本**：cloudbaserc 仍 Nodejs16.13（L11/L21），P0-2 Node18 升级状态待确认；本期是否一并处理。

11. **趋势页失败测试契约**：以 bpBg 复合指标新结构为准更新测试，还是回退默认数据（影响家属态趋势设计）。



***

## 5. 不确定项 / 待运行验证 / 待人工确认



| 项                                                | 状态             | 说明                                                                                  |
| ------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------- |
| 微信云调用是否稳定注入 event.userInfo.openId、有无其他触发端可绕过     | 待运行验证          | 代码依赖注入（index.js L208-L214），前端未自构 userInfo（core.js L161-L162）；需在云函数日志或测试环境核验，关联 P0-1 |
| 线上集合权限规则（family\_members/family\_auth 是否仅云函数可读写） | 待人工确认          | 仓库无安全规则文件；初始化清单 L37 仅为建议                                                            |
| family\_auth.inviteCode 唯一索引是否已建                 | 待人工确认          | Schema L251 仅表述 "需要唯一约束"                                                            |
| 线上家庭数据存量                                         | 待人工确认          | 决定 backfill 策略                                                                      |
| mergeHomeFamilyMedicationStatus 显示串扰是否真实发生       | 待运行验证          | 需构造家属与 owner logId 相同的场景（medication-merge.js L237-L256）                             |
| allowStale 兜底在撤销后弱网下的实际表现                        | 待运行验证          | core.js L237-L239 不校验 TTL，仅内存态                                                      |
| 微信开发者工具 CLI/automator 接入                         | 待验证（本期禁启动 IDE） | 阶段 0 仅枚举到进程；历史日志指向旧工程路径 D:\CursorWorkspace\xiaochengxu                              |
| 豆包工作界面所选模型                                       | 待人工留图确认        | 不以自报身份为证                                                                            |
| service-regression-test.txt（仓库根）用途               | 待确认            | 存在且被 project.config.json L115 打包忽略，未被 package.json 引用                               |
| 数据库文档与控制台清单的一致性                                  | 已部分核对          | 初始化清单新增 4 集合（L16-L19）；family\_auth 未列入新增；COLLECTIONS 11 个 + push\_logs 共 12 个集合名    |



***

## 6. 关键证据索引（文件：行号）



* 占位开关：pages/family/index.wxml L14-L20、L21-L78；pages/family/index.js L73-L124

* 死页：app.json L52；pages/family-sub/index.js L12-L22；utils/routes.js L33-L37

* 家庭路由：utils/routes.js L10、L33-L37；app.json L49-L59、L102-L105

* 预检查范围：utils/pre-check.js L207-L222（PROTECTED）、L238-L244（PROFILE\_FREE）

* 云端身份：index.js L208-L214、L1285-L1297

* 权限判定（仅 enabled）：index.js L552-L578；services/family.js L43-L47

* 默认 scopes/noticeRules/relations：index.js L354-L381、L387-L408、L528-L535

* 关系上下文：index.js L620-L659（limit 1：L621-L628）

* 受控读：family-service.js L32-L172（判定 L56-L59；查询 L80、L101、L113）

* 邀请枚举面：family-service.js L311-L372（错码通用页 L359-L371）；路由 index.js L1344

* 邀请页 5 scopes（含 missedNotice）：family-service.js L267-L309

* 改权批量更新：family-service.js L445-L518（退化 where L476-L502）

* 创建邀请 upsert/24h / 残留：family-service.js L520-L589（expiresAt L549）

* 加入校验：family-service.js L591-L619

* 撤销两分支：family-service.js L697-L788（memberId 同步条件 L737；无 memberId 只撤 auth L759-L782）

* 无家属写通道：index.js L1162-L1181、L1195-L1214、L1260-L1275；medication-service.js L324-L352、L383-L432、L434-L441

* record/report 无 family 概念：grep record-service.js/report-service.js 零命中

* 二级页丢上下文：pages/family-sub/home-family/index.js L71-L115

* 本地镜像：services/family.js L73-L210（无过期 L124-L157；slice (1) L163-L165；enforce L202-L210）

* 云读缓存：services/core.js L22-L24、L94-L96、L192-L196、L237-L239；脏页 L32、L121

* 家属首页后处理：utils/api.js L257-L262；显示串扰源 services/medication-merge.js L237-L256

* 注销 / 导出：settings-data-service.js L175-L189、L592-L646、L648-L672、L674-L725

* 定时推送只发本人：sendDueReminders/index.js L25、L28-L36、L138-L142、L284-L358、L360-L420；config.json L6

* 邀请码格式：index.js L239-L243

* 归一化白名单缺失：index.js normalizeFamilyInvitePayload L834-L854、normalizeFamilyAuthPayload L683-L697 附近

* 测试配置：package.json L8、L11-L13、L15-L36

* 回归漂移点：scripts/health-api-regression.js L295（todayLogs）、跳过 L318-L430、L432-L519；复制逻辑 L172-L232、约 L387-L406；mock matches L150-L157

* 失败测试：tests/unit/page-data-consistency.test.js L34-L52；输出 evidence/00-baseline/2026-09-21/test.txt L568-L611

* 合规边界：static-pages.js L62-L65、L88-L92、L164-L167、L186-L190；home-family/index.wxml L92；family-auth/index.wxml L75

* 运行时：cloudbaserc.json L2、L11、L21；app.js L36-L40；utils/api-config.js L9-L10

* 设计 / 任务稿：qa/designs/P2-4-family-permission.md L15-L27、L34-L43、L49-L94、L99-L108；qa/tasks/P2-4-family-permission.md L5-L25