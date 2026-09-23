# 康小记「家庭」Tab 只读分析报告

> 分析日期：2026-08-11
> 分析方式：只读，未创建/修改/删除任何业务文件，未执行改变 Git 或云端状态的命令。
> 目标：开放「家庭」Tab，并实现家属的 read / write / remind 三档权限；健康数据只能在授权范围内查看或代录；不涉及诊断、治疗、处方或健康建议。

---

## 0. 分析范围与结论性判断

- 项目数据源已切到云函数：`utils/api-config.js` L8-L12 `dataSource: 'cloud'`，云函数 `healthApi`。
- 「家庭」Tab 已在 tabBar 注册（`app.json` L101-L106），但页面正文被 `coming-soon` 占位（`pages/family/index.wxml` L14-L20），真实 UI 整段被注释。
- 后端「读」侧已有较完整的跨账号鉴权（`family_members` → ownerOpenId + scopes），见 `cloudfunctions/healthApi/family-service.js` L32-L172 与 `cloudfunctions/healthApi/index.js` L620-L659。
- 「写（代录）」侧目前完全没有家属权限通道：记录/用药的写入全部以「当前 openId 即数据 owner」为前提（见第 3 节）。
- 权限模型目前是旧的两级 `enabled: true/false`，三级 `read/write/remind` 仅有设计稿（`qa/designs/P2-4-family-permission.md`），代码未落地。
- 设计文档明确写入「不涉及诊断、治疗、处方或健康建议」的边界（`cloudfunctions/healthApi/static-pages.js` L62-L65、Schema 文档第 10 节）。

---

## 1. 家庭功能完整调用链

### 1.1 页面层（主包 + family-sub 分包）

| 角色 | 文件 | 说明 |
|---|---|---|
| Tab 主入口 | `pages/family/index.js` | 调 `getFamilyData` / `revokeFamilyMember`；按钮 `inviteFamily`、`previewFamily`、`manageMember`、`revokeMember` |
| Tab 主入口视图 | `pages/family/index.wxml` | 目前仅渲染 `<coming-soon>`，真实成员列表在注释块 L21-L77 |
| 分包导航中转 | `pages/family-sub/index.js` | 三个卡片跳 invite/join/auth（注意：该页面已在 app.json 注册，但当前没有任何入口指向它，是孤立页） |
| 邀请家属 | `pages/family-sub/family-invite/index.js` | onLoad 即调 `createFamilyInvite`，切换关系/权限会再次创建邀请 |
| 加入家庭 | `pages/family-sub/family-join/index.js` | `getFamilyJoinData` + `joinFamilyByInvite` |
| 等待邀请提示 | `pages/family-sub/family-join-hint/index.js` | 只读静态 |
| 授权管理 | `pages/family-sub/family-auth/index.js` | `getFamilyAuthData` / `updateFamilyAuth` / `revokeFamilyMember` |
| 家属视角首页 | `pages/family-sub/home-family/index.js` | `getHomeFamilyData`，跳转 trend/medList/medConfirm/recordList |

路由集中在 `utils/routes.js` L32-L37，分包注册见 `app.json` L48-L59。

### 1.2 门面层 utils/api.js

家庭相关导出集中在 `utils/api.js` L335-L359：

- 读：`getFamilyData`、`getFamilyInviteData`、`getFamilyJoinData`、`getFamilyAuthData`、`getHomeFamilyData`、`getFamilyJoinHintData`
- 写：`createFamilyInvite`、`joinFamilyByInvite`、`updateFamilyAuth`、`revokeFamilyMember`

`getHomeFamilyData` 链路特殊：先走云函数 `resolveMockData('homeFamily')`，再 `.then(family.enforceHomeFamilyAccess)` 与 `.then(medication.mergeHomeFamilyMedicationStatus)`，见 `utils/api.js` L257-L262。注意：`enforceHomeFamilyAccess` 只检查**本地** `family_auth_v1`（`services/family.js` L202-L210），云端 `family_members` 才是真正的鉴权来源，本地这层只在 cloud 模式下作为兜底/镜像。

### 1.3 services 层

- `services/family.js`：本地缓存 `family_auth_v1` 的镜像与归一化。所有写操作通过 `resolveRemote(action, payload, localHandler, { mirrorLocal: true })` 实现「云端成功后镜像写本地」（L320-L342）。
- `services/core.js`：`resolveMockData`（读走 `requestCloudByKey`，带 60s 内存缓存）、`resolveRemote`（写走 `requestCloud`，成功后清云读缓存），见 L225-L290。
- 脏页联动：`DIRTY_MAP` L27-L38 中 `familyAuth` 变更会标记 `family/home/homeFamily` 三页脏。
- `services/data-rights.js`：导出/删除/清空账号，会把 `familyAuth` 纳入快照（L21）。

### 1.4 云函数层

入口：`cloudfunctions/healthApi/index.js`

- 读 keyMap（L1323-L1354）：`family`、`familyInvite`、`familyJoin`、`familyAuth`、`homeFamily`
- 写 actionMap（L1364-L1385）：`createFamilyInvite`、`joinFamilyByInvite`、`updateFamilyAuth`、`revokeFamilyMember`
- 业务实现在 `cloudfunctions/healthApi/family-service.js`
- 身份：`getOpenId(event)` 从 `event.userInfo.openId` 取（`cloudfunctions/healthApi/index.js` L208-L214），失败除 `rebuildRecordStats` 外直接抛错。

### 1.5 数据库集合

见 `cloudfunctions/healthApi/index.js` L41-L53 与 `docs/云开发数据库Schema设计文档.md`：

| 集合 | 家庭相关用途 |
|---|---|
| `family_auth` | 邀请发起方文档（owner 视角），含 inviteCode、scopes、noticeRules、memberOpenId |
| `family_members` | 真实跨账号绑定关系，含 ownerOpenId、memberOpenId、scopes、status |
| `profiles` | 提供 ownerName 冗余回填 |
| `health_records` | 家属读时按 ownerOpenId + type 过滤 |
| `medication_plans` / `medication_confirmations` | 家属读用药状态 |
| `reminder_push_logs` | 定时推送去重（`cloudfunctions/sendDueReminders/index.js` L25） |

注意：`family_auth` 与 `family_members` 是**双写**关系。`updateFamilyAuth` 在更新 auth 后会按 `ownerOpenId`（或指定 memberId）批量同步到 family_members，见 `cloudfunctions/healthApi/family-service.js` L445-L518。

---

## 2. 当前「家庭」Tab 被占位的原因与开放前风险

### 2.1 占位直接原因

`pages/family/index.wxml` L14-L20 显式渲染 `<coming-soon>`，真实 UI 在 L21-L77 被整段注释。注释明确写「家庭功能开发中……上线后移除 coming-soon 标签即可恢复下方原始内容」。

`pages/family/index.js` 逻辑其实已完整：onLoad/onShow 拉数据、邀请、预览、管理、解除、分享都已接好。这是一次**有意的前端开关**，不是代码缺失。

### 2.2 占位背后的真实未完成项（代码证据）

1. **三级权限未落地**：全仓没有 `read/write/remind` 字段，只有 `enabled`。`P2-4-family-permission` 仍是设计稿，未实施。
2. **没有「代录」后端通道**：所有写接口签名都是 `(openId, payload)`，并把 `_openid: openId` 写死为数据归属。家属即使进入 medConfirm/recordBp，提交的记录也会写到**家属自己**名下，而非 owner 名下。
3. **家属视角页面跳错目标**：`pages/family-sub/home-family/index.js` L89-L114 点击用药/记录直接 `goRoute('medConfirm')` / `goRoute('recordList')` / `goRoute('trend')`，这些页面全部按当前 openId 查自己的数据，对家属而言会看到空白或自己的数据，造成越权/混淆。
4. **family-sub/index 中转页是死页**：`app.json` L52 注册了 `pages/family-sub/index`，但 routes.js 没有对应键，也没有任何页面跳它。
5. **邀请页 onLoad 立即创建邀请**：`pages/family-sub/family-invite/index.js` L29-L33 每次进入/切换 scope 都会调 `createFamilyInvite`，会覆盖 `family_auth`（云端是 upsert，`cloudfunctions/healthApi/family-service.js` L553-L573）。开放后会把已有邀请/已加入关系的 scopes 意外重置。
6. **`family_auth` 单文档设计限制多家属**：owner 只有一条 `family_auth`（按 `_openid` limit 1），多家属靠 `family_members` 区分；但 `createFamilyInvite` upsert 同一条 auth，新邀请会覆盖旧邀请的 member/scopes，已加入家属的 auth 视图可能被冲掉（revokeMember memberId 分支能定位 family_members，但 family_auth 同步只在 `authList[0].memberOpenId === relation.memberOpenId` 时处理）。
7. **`remind` 权限无对应实现**：`noticeRules` 已存在（missedMedicine/missingRecord/weeklyReport），但 `sendDueReminders` 只扫**本人**用药/测量/周报，从不向家属 openId 推送（`cloudfunctions/sendDueReminders/index.js` L284-L358）。

### 2.3 开放前必须解决的安全风险

- **越权读取**：`record-service.js`、`report-service.js` 经 grep 确认完全没有 family/ownerOpenId 概念（`No matches found`）。家属若能进入 trend/recordList，只能看到自己的数据；但若未来加代录而不补鉴权，会直接越权。
- **越权写入（最高危）**：`saveBloodPressureRecord` / `saveMedicationPlan` / `confirmMedication` 等写接口当前没有任何「家属代录」校验。一旦开放家属端按钮而不新增 ownerOpenId 入参和服务端鉴权，会把数据写到错误账号，或被伪造 openId 写入他人集合。
- **邀请码安全**：`createInviteCode()` 仅 8 位 base36 时间+随机（`cloudfunctions/healthApi/index.js` L239-L243），无尝试次数限制、无唯一索引（Schema 文档 L433 仅「后续应保证唯一」）。`getFamilyJoinData` 仅凭 inviteCode 查询即返回 ownerName 与 scopes（`cloudfunctions/healthApi/family-service.js` L311-L358），存在枚举泄露风险。
- **`updateFamilyAuth` 越权**：`cloudfunctions/healthApi/family-service.js` L445-L518 中，当 `memberId` 为空时，`relationWhere` 退化为 `{ ownerOpenId: openId, status: 'active' }`，会**批量更新该 owner 下所有家属**的 scopes/noticeRules。family-auth 页面在新建（无 id）场景下确实不传 memberId（`pages/family-sub/family-auth/index.js` L109-L115），可能误伤。
- **`revokeFamilyMember` 无 memberId 分支**会撤销 `family_auth`（owner 自己的授权文档），而不是具体家属（`cloudfunctions/healthApi/family-service.js` L759-L788）。前端 family 页 revokeMember 传了 memberId，family-auth 页 revokeAuth 也传 memberId（取自 `this.data.memberId`，可能为空串），空串时走兜底分支会整体撤销。
- **本地缓存可被篡改**：`enforceHomeFamilyAccess` 与 services/family.js 的本地镜像只基于 wx.storage，不能作为授权依据；真实鉴权必须在云函数。当前架构这点是对的（云端再查 family_members），但要注意开放后不能把本地 scope 当权限源。
- **合规边界**：文案已声明「不提供诊断/治疗/处方/急救判断」（`pages/family-sub/home-family/index.wxml` L92、`pages/family-sub/family-auth/index.wxml` L75）。开放代录时不能新增任何「建议/判断」类输出，`tip/level` 字段沿用现有口径即可。

---

## 3. 读写健康数据 / 邀请 / 加入 / 更新权限 / 撤销授权的入口与身份校验现状

### 3.1 健康数据读

| 入口 | 前端调用 | 云函数 | 身份/授权校验 |
|---|---|---|---|
| 家属首页 | `getHomeFamilyData` → key `homeFamily` | `getFamilyService().getHomeFamilyData(openId)` | 先 `getFamilyAccessContext(openId)` 查 `family_members`（member 模式）或 `family_auth`（ownerPreview 模式），再按 `isRelationScopeEnabled` 过滤 bp/bg/medicine/report（`cloudfunctions/healthApi/family-service.js` L56-L116） |
| 家属页点「趋势」 | `goRoute('trend')` | `getRecordService().getTrendData(openId, payload)` | **无家属鉴权**，record-service 仅按 `_openid: openId` 查本人 |
| 家属页点「全部记录」 | `goRoute('recordList')` | `getRecordListData(openId)` | **无家属鉴权** |
| 家属页点用药 | `goRoute('medList')` / `goRoute('medConfirm')` | medication-service | **无家属鉴权**，全部按本人 openId |
| 家属页点指标卡 | `goRoute('recordDetail')` | record-service | **无家属鉴权** |

结论：跨账号读目前**只有 `homeFamily` 一条路径**真正受控；家属页所有跳转出去的二级页都没有家属态，会漏权或显示空。

### 3.2 健康数据写（含代录）

| 入口 | 云函数 | 现状 |
|---|---|---|
| 血压记录页 `saveBloodPressureRecord` | `cloudfunctions/healthApi/index.js` L1162-L1181 | `_openid: openId` 写死，无 ownerOpenId 参数，无家属写权限校验 |
| 血糖记录页 `saveBloodGlucoseRecord` | `cloudfunctions/healthApi/index.js` L1195-L1214 | 同上 |
| 删除记录 `deleteRecord` | `cloudfunctions/healthApi/index.js` L1260-L1275 | `assertOwnedDocument` 校验本人归属；家属无法删 owner 记录（也无入口） |
| 用药计划 `saveMedicationPlan` | medication-service L324-L358 | 更新走 `assertOwnedDocument`；新增 `_openid: openId` |
| 用药确认 `confirmMedication` | medication-service L383-L432 | `_openid: openId` + `logId` upsert，**无家属代确认通道** |

结论：**目前不存在任何「家属代录」服务端路径**。三级权限中的 `write` 完全没有承接点。

### 3.3 邀请 / 加入 / 更新权限 / 撤销

| 动作 | 前端入口 | 云函数 | 身份校验 |
|---|---|---|---|
| 创建邀请 | `pages/family-sub/family-invite/index.js` L89-L104 | `createFamilyInvite(openId, payload)` | 以 openId 为 owner；校验「至少一个 scope enabled」（`cloudfunctions/healthApi/index.js` L839-L841）；upsert 单条 family_auth |
| 查询加入信息 | `pages/family-sub/family-join/index.js` L27-L29 | `getFamilyJoinData(payload)` | **无需登录态即可按 inviteCode 查询**（keyMap L1344 不传 openId 给 service），返回 ownerName/scopes |
| 加入家庭 | `pages/family-sub/family-join/index.js` L72-L97 | `joinFamilyByInvite(openId, payload)` | 校验：邀请存在、未 revoked、未被其他家属使用、未过期、不能加自己（`cloudfunctions/healthApi/family-service.js` L602-L619）；upsert family_members 并把 family_auth.status 置 active |
| 更新权限 | `pages/family-sub/family-auth/index.js` L106-L127 | `updateFamilyAuth(openId, payload)` | 按 `_openid: openId` 找 family_auth；memberId 为空时**批量更新**该 owner 所有 active family_members（见 2.3 风险） |
| 撤销授权 | family 页 `revokeMember` / auth 页 `revokeAuth` | `revokeFamilyMember(openId, payload)` | memberId 分支校验 `ownerOpenId: openId`；无 memberId 分支直接撤销 owner 自己的 family_auth（见 2.3） |
| 注销连带撤销 | 数据管理页 | `clearUserAccount` | `cloudfunctions/healthApi/settings-data-service.js` L705 调 `updateFamilyAuthByMember` 把 memberOpenId=本人的 family_auth 置 revoked |

### 3.4 前端页面级准入

- 预检查：`utils/pre-check.js` L207-L229 把 `pages/family/index`、`family-invite`、`family-join`、`family-auth`、`home-family` 都列为 PROTECTED，要求隐私+基础资料。`family-join` 与 `family-join-hint` 被加入 PROFILE_FREE（L238-L244），允许未设资料者加入。
- 但预检查只校验「是否完成 onboarding」，**不校验家属身份/授权**。家属身份完全依赖云函数。

---

## 4. 旧 scopes 到 read/write/remind 的兼容方案

### 4.1 现状数据结构

旧结构（云端 + 本地 + 默认值均为此结构）：

```js
{ key: 'bloodPressure', title: '血压记录', meta: '...', enabled: true }
```

出现位置：

- 默认值：`cloudfunctions/healthApi/index.js` L354-L381（云函数）、`cloudfunctions/healthApi/family-service.js` L271-L302（invite 页返回）、`services/page-data.js` L144-L146
- 鉴权判断：`isScopeEnabled` / `isRelationScopeEnabled`（`cloudfunctions/healthApi/index.js` L552-L565）只认 `enabled`
- 展示：`getScopeText`（`cloudfunctions/healthApi/index.js` L572-L578、`services/family.js` L43-L47）只过滤 `enabled`
- 邀请校验：`normalizeFamilyInvitePayload` 用 `scope.enabled` 判断「至少选一个」（`cloudfunctions/healthApi/index.js` L839）

### 4.2 设计稿给出的兼容策略

`qa/designs/P2-4-family-permission.md` L24-L27：

```
读取旧数据时：enabled=true → { read: true, write: false, remind: true }
写入新数据时：使用三级格式
```

并给出 `hasScopePermission(scopes, scopeKey, permission)` 草稿（L76-L86），`getScopeText` 改为 `s.read || s.enabled`。

### 4.3 建议的兼容方案（基于代码现状，待确认后再开发）

1. **统一归一化函数**（云端 + services 双份）：`normalizeScope(scope)`，输出 `{ key, title, meta, read, write, remind }`：
   - 若含 `enabled`（旧）：`read=!!enabled, write=false, remind=!!enabled`
   - 若含三级字段（新）：直接读取，缺省按 false
   - 三者全 false 时等价于「未授权」
2. **鉴权函数替换**：新增 `hasScopePermission(scopes, key, perm)`，替换云端所有 `isScopeEnabled/isRelationScopeEnabled` 调用点（family-service、index.js），并按 `perm` 分流：读用 read、代录用 write、提醒推送用 remind。
3. **写入时统一升级**：`normalizeFamilyAuthPayload`、`normalizeFamilyInvitePayload` 在落库前把入参 scopes 经 `normalizeScope` 转成三级格式；这样新写入/更新的文档自动升级，无需一次性迁移脚本。
4. **读取时兼容**：`getFamilyData/getFamilyAuthData/getFamilyJoinData/getHomeFamilyData` 返回前统一归一化，保证前端拿到的始终是三级结构；前端旧的 switch 绑定 `item.enabled` 需改成三态 UI。
5. **本地缓存**：`services/family.js` 的 `getScopeText`、`mapFamilyMember`、`mergeFamilyMemberScope` 同步改造；因为 `mirrorLocal` 会把云端结果写回本地，云端归一化后本地自然升级。
6. **提醒权限独立**：`noticeRules` 与 `scopes.remind` 是两个维度。建议保留 noticeRules 作为「提醒类型开关」，scopes.remind 作为「该家属是否接收某类提醒」的总闸；推送时两者都为 true 才发。当前 `sendDueReminders` 完全不查 family_members，需要新增「向家属推送」分支。
7. **邀请码有效期**：设计稿要求 24h；云端 `createFamilyInvite` 已写 `expiresAt`（`cloudfunctions/healthApi/family-service.js` L549），`joinFamilyByInvite` 已校验过期（L612-L614）。本地 services 层未校验 expiresAt（设计稿 L62-L70 提到但未实现），云模式下不影响，但建议补齐。
8. **回归测试数据**：`scripts/health-api-regression.js` L173-L201 仍是 enabled 结构，需要同步加三级用例与旧→新映射用例。

### 4.4 无法确认项

- 生产环境 `family_auth` / `family_members` 是否已有真实数据、数据量多少：仓库内无迁移脚本与数据快照，**无法确认**。是否需要一次性 backfill 脚本取决于线上数据规模，建议开放前在云开发控制台核查。
- 是否要求「旧邀请码无 expiresAt 视为永不过期」（设计稿 L100）与实际线上数据是否一致：代码里 `getFamilyJoinData` 对无 expiresAt 的 auth 取 `Date.now() + 24h`（`cloudfunctions/healthApi/family-service.js` L341），但 join 校验只在 `auth.expiresAt` 存在时才判过期，行为与设计稿一致。

---

## 5. 需要修改的文件清单（按依赖顺序的实施阶段）

以下为**计划清单**，不是改动。阶段顺序满足「后端权限模型 → 后端代录通道 → 前端权限 UI → 家属态二级页 → Tab 放开 → 测试文档」。

### 阶段 A：权限模型与兼容基础（无 UI 变化）

- `cloudfunctions/healthApi/index.js`：新增 `normalizeScope`、`hasScopePermission`；改造 `getDefaultFamilyScopes`、`isScopeEnabled`、`isRelationScopeEnabled`、`getScopeText`、`normalizeFamilyAuthPayload`、`normalizeFamilyInvitePayload`
- `cloudfunctions/healthApi/family-service.js`：所有读点按 read 过滤；`updateFamilyAuth` 修复 memberId 为空时的批量更新问题；invite 返回三态
- `services/family.js`：本地 `getScopeText`/`mapFamilyMember`/`mergeFamilyMemberScope` 兼容三态
- `services/page-data.js` L144-L146：`familyInvite/familyJoin/familyAuth` 默认结构升级

### 阶段 B：家属代录（write）后端通道

- `cloudfunctions/healthApi/index.js`：`saveBloodPressureRecord/saveBloodGlucoseRecord/deleteRecord` 增加可选 `ownerOpenId`；新增「校验 family_members 且 scope.write=true」的辅助函数
- `cloudfunctions/healthApi/record-service.js`：列表/详情/趋势支持按被授权 ownerOpenId 读取（需带 scope.read 校验）
- `cloudfunctions/healthApi/medication-service.js`：`confirmMedication` 支持代确认（写入 owner_openid，但记录操作者 memberOpenId）；用药计划的写不建议开放给家属（家属只确认，不编辑计划，需产品确认）
- `services/records.js`、`services/medication-confirm.js`、`utils/api.js`：传递 ownerOpenId，区分「本人记录」与「代录」

### 阶段 C：家属读路径覆盖（趋势/记录/用药详情）

- cloudfunctions record/report/medication service：所有按 openId 的读接口支持「家属态」
- 前端 `pages/trend/index.js`、`pages/record/record-list/index.js`、`pages/record/record-detail/index.js`、`pages/medication/med-list/index.js`、`pages/medication/med-confirm/index.js`：接收 ownerOpenId/relationId 路由参数，按家属态加载与禁用无权限操作

### 阶段 D：家属权限 UI 与邀请页改造

- `pages/family-sub/family-auth/index.wxml` + .js：每个 scope 三态控件（查看/代录/提醒），替代单个 switch
- `pages/family-sub/family-invite/index.wxml` + .js：邀请时三态选择；移除 onLoad 自动创建，改为「显式生成/分享时创建」，避免覆盖
- `pages/family-sub/family-join/index.wxml`：展示三态授权说明
- `pages/family-sub/home-family/index.wxml` + .js：按 write 权限显示/隐藏「代记录」「代确认」按钮；跳转携带 ownerOpenId

### 阶段 E：家属提醒（remind）通道

- `cloudfunctions/sendDueReminders/index.js`：新增扫描 family_members 中 remind=true 的家属，向 memberOpenId 推送；模板 ID 可能需要新增家属类模板（当前只有 medicine/measure/weeklyReport 三个模板，L28-L32）
- `cloudfunctions/healthApi/static-pages.js`：隐私政策/家庭授权文案补充三态说明

### 阶段 F：开放 Tab

- `pages/family/index.wxml`：移除 `<coming-soon>`，放开注释 UI；按需把 scope 文案改为三态汇总
- `pages/family/index.json`：可移除 coming-soon 组件注册
- 决定 `pages/family-sub/index.*` 的去留：删除或接入 routes.js

### 阶段 G：测试与文档

- `tests/unit/family.test.js`：补三态兼容、hasScopePermission、旧→新映射
- `scripts/health-api-regression.js`：补三态 scope、代录越权用例
- 新增云端权限测试（当前 regression 用 mock db，可扩展）
- `docs/云开发数据库Schema设计文档.md` 3.5/3.6：scopes 结构改为三级
- `qa/tasks/P2-4-family-permission.md`：勾选完成项并记录实际偏差

---

## 6. 测试 / Lint / 回归脚本 / 文档 / 配置的不一致项

### 6.1 测试

- Jest 配置收集 `services/**`、`utils/**` 覆盖率（`package.json` L23-L27），阈值 branches 60 / functions 70 / lines 70，但**不包含 `cloudfunctions/`**，云端权限逻辑无覆盖率约束。
- 云端逻辑靠独立脚本 `scripts/health-api-regression.js`（`npm run regression`），它在脚本内重新定义了 `getScopeText/isRelationScopeEnabled/getDefaultFamilyScopes/normalizeFamilyAuthPayload` 等（L172-L232），**与 index.js 中的真实实现是两份代码**，存在漂移风险（例如未来改三态时容易只改一处）。
- `tests/unit/routes-consistency.test.js` 校验 tabBar 路由存在，但不校验 `family-sub/index` 是否被 routes.js 引用（死页不会被测试发现）。
- `family.test.js` 未覆盖 `createFamilyInviteLocal/joinFamilyByInviteLocal/updateFamilyAuthLocal/revokeFamilyMemberLocal` 四个本地镜像函数。
- 没有任何测试断言「家属不能写 owner 数据」「无 read 权限不返回字段」等安全属性。

### 6.2 Lint

- `.eslintrc.js` 规则严格（eqeqeq/no-shadow/prefer-const 等），`npm run lint` 只扫 `services/ utils/ pages/ components/`，**不扫 `cloudfunctions/`、`scripts/`、`tests/`**（tests 有 overrides 但不在 lint 命令内）。
- 代码里有多处 `console.log`（如 `utils/api.js` L189-L192），按 `no-console: warn` 仅告警；云函数内 console.log 是有意保留（perf 日志）。
- `cloudfunctions/healthApi/family-service.js` 整体未被 lint 覆盖，潜在风格问题不会阻断提交。

### 6.3 回归脚本

- `service-regression-test.txt` 在仓库根目录但未被 package.json script 引用（`project.config.json` L115 把它列入打包忽略），**无法确认其用途与是否仍有效**。
- `npm run regression` 不依赖 wx-server-sdk，用 mock db，但 mock 的 `matches` 只支持等值与 `_.in`（`scripts/health-api-regression.js` L150-L157），不支持 `_.gte/_.lte/.and`，因此 settings-data-service 的范围删除/统计分支未被真实覆盖。

### 6.4 文档

- Schema 文档 L273-L278 仍写旧 enabled 结构，与 P2-4 设计稿不一致。
- Schema 文档 L524 给出的 api-config 路径是 `D:/CursorWorkspace/xiaochengxu/utils/api-config.js`，与当前实际路径不符。
- `docs/云开发控制台初始化清单.md` 未读取，无法确认其集合清单是否与 COLLECTIONS 一致（建议开放前复核，本次未展开）。
- P2-4 任务文档列了 4 个功能点，但实际代码只部分实现了「邀请码 24h」，关系类型扩展、三态权限、权限校验都未做，任务状态未更新。

### 6.5 配置

- `cloudbaserc.json` L7-L13 运行时是 `Nodejs16.13`，而 `qa/designs/P0-2-node18.md` 提到 Node18 升级（设计稿内容本次未展开核对，仅标注不一致存在）。
- `project.config.json` L71-L73 把 `cloudfunctions` 整个目录列入打包忽略，这是小程序端打包预期行为（云函数单独部署），但意味着云函数与小程序版本不会同步发布，开放家庭 Tab 时必须分别部署。
- `app.js` L37 硬编码云环境 ID `kangxiaoji-d5gw2k203f0488a9e`，与 `cloudbaserc.json` L2 一致。
- `app.json` 注册了 `pages/family-sub/index`，但 `utils/routes.js` 无对应键，造成不可达页面。
- tabBar 4 个图标齐全（`assets/icons/`），无资源缺失。
- `pages/family-sub/family-invite/index.wxml` 展示 5 个 scope（含 missedNotice），但云端 `getFamilyInviteData` 也返回 5 个（`cloudfunctions/healthApi/family-service.js` L271-L302），而 `getDefaultFamilyScopes` 只有 4 个（不含 missedNotice）。missedNotice 属于 noticeRules 范畴却混在 scopes 里，保存时 `normalizeFamilyInvitePayload` 会把它当 scope 落库，模型边界混乱。开放三态前需要厘清。

---

## 7. 每项结论的文件依据索引

- 占位：`pages/family/index.wxml` L14-L20
- Tab 注册：`app.json` L101-L106
- 云端鉴权入口：`cloudfunctions/healthApi/index.js` L620-L659
- 家属读过滤：`cloudfunctions/healthApi/family-service.js` L56-L116
- 写接口无 owner 概念：`cloudfunctions/healthApi/index.js` L1162-L1214、`cloudfunctions/healthApi/medication-service.js` L383-L432
- updateFamilyAuth 批量更新风险：`cloudfunctions/healthApi/family-service.js` L470-L502
- revoke 无 memberId 兜底：`cloudfunctions/healthApi/family-service.js` L759-L788
- 邀请枚举面：`cloudfunctions/healthApi/family-service.js` L311-L358
- 邀请 onLoad 立即创建：`pages/family-sub/family-invite/index.js` L29-L33
- 三级权限设计稿：`qa/designs/P2-4-family-permission.md`
- 旧 enabled 结构默认值：`cloudfunctions/healthApi/index.js` L354-L381
- 定时推送未含家属：`cloudfunctions/sendDueReminders/index.js` L284-L358
- 合规文案：`cloudfunctions/healthApi/static-pages.js` L62-L65、`pages/family-sub/home-family/index.wxml` L92
- 测试配置：`package.json` L7-L35
- Lint 范围：`package.json` L11-L12
- 死页：`app.json` L52、`utils/routes.js`（无 family-sub 根路由键）

### 无法确认 / 需要确认的点

1. 线上云数据库是否已有真实 `family_auth/family_members` 数据、量级多少（决定是否需要 backfill 脚本）。
2. 家属「代录」是否允许代录**用药计划**（增删改计划），还是仅允许代确认已服/跳过。当前代码两种都没有通道，产品口径需明确。
3. 家属「提醒」推送给家属时，使用现有三个订阅模板还是申请新模板；家属端订阅授权从哪个页面触发。
4. 多家属并发邀请时，`family_auth` 单文档是否要改为「一个邀请一文档」或「一个 member 一文档」，否则当前 upsert 会互相覆盖。
5. `pages/family-sub/index` 中转页是删除还是接入。
6. P0-2 Node18 升级是否已在其他分支完成（当前 cloudbaserc 仍是 Node16.13）。

---

## 8. 暂不写代码的实施计划

等待确认后再进入开发。建议节奏：

1. **第 1 步（拍板产品口径）**：明确第 7 节「无法确认」中的 6 个点，尤其是代录范围、多家属模型、提醒模板。
2. **第 2 步（阶段 A 权限模型）**：云端 + services 落地 `normalizeScope/hasScopePermission`，旧 enabled 自动映射 read+remind，write 默认 false；补单元测试与回归用例；不改变任何 UI。此步可独立上线，不影响现有功能。
3. **第 3 步（阶段 B 代录通道）**：云函数为血压/血糖/用药确认增加 `ownerOpenId` 入参与服务端 family_members + write 鉴权；记录写入时冗余 `createdByMemberOpenId` 便于审计；前端先不开放入口。
4. **第 4 步（阶段 C 家属读全覆盖）**：trend/recordList/recordDetail/medList/medConfirm 支持家属态查询，按 read 权限过滤；home-family 的跳转携带 ownerOpenId。
5. **第 5 步（阶段 D UI）**：family-auth 改三态控件；family-invite 改三态选择 + 去掉 onLoad 自动创建；home-family 按 write 显示代录按钮；修复 updateFamilyAuth/revoke 的 memberId 边界。
6. **第 6 步（阶段 E 提醒）**：sendDueReminders 增加家属推送分支，scopes.remind 与 noticeRules 双重判断；家属端订阅授权入口。
7. **第 7 步（阶段 F 放开 Tab）**：移除 coming-soon、清理死页、回归全流程（邀请→加入→读→代录→改权限→撤销→注销）。
8. **第 8 步（阶段 G 文档与合规复核）**：更新 Schema 文档、P2-4 任务状态、隐私政策文案；确认无诊断/治疗/处方类输出；部署云函数与小程序。

每一步都要求：`npm test`、`npm run lint`、`npm run regression` 全绿；云端改动在测试环境验证后再部署生产。
