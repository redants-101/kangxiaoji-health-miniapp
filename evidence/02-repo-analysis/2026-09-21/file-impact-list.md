# 阶段 2 · 拟修改文件清单与实施计划（file-impact-list）

- 日期：2026-09-21；分支 `feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 本文件是**只读审计产物**：仅规划，不含任何已发生改动。业务代码、测试、依赖、配置本轮零修改。
- 分级：**A = 核心权限闭环（本期必须）**；**B = 影响本次验证的历史问题（建议先于或随 A 做，否则改动无护栏）**；**C = 可延期的无关问题**。
- 所有"拟改"均须在用户对第 5 节业务选择拍板后实施；实施阶段另起任务，不在阶段 2 范围。

---

## 0. 依赖顺序总览

```
B1/B2（让回归能跑完、停止复制逻辑）── 建议最先，恢复云端自动化护栏
        │
A0 三级权限模型 + 归一化白名单 + 旧数据兼容（所有后续阶段的数据契约）
        │
A1 多成员关系模型修复（改权/撤销/邀请的精确性，安全基线）
        │
        ├──> A2 邀请流程与枚举面（依赖 A1 的文档模型）
        ├──> A3 二级页家属态 read 闭环（依赖 A0/A1）
        │         │
        │         └──> A4 代录 write 闭环（复用 A3 的服务端鉴权）
        ├──> A5 撤销实时生效与缓存/镜像一致性（依赖 A1）
        └──> A6 家属 remind 推送（依赖 A0 的 remind 语义、A1 关系扫描）
                  │
A7 Tab 放开、死页处置、回滚开关、合规文案（最后，依赖 A1-AA6 验收通过）
```

---

## A. 核心权限闭环

### A0 三级权限数据模型与归一化（契约先行）

- 目标：把全链路 `{key,title,meta,enabled}` 升级为设计稿的 `{read,write,remind}`（qa/designs/P2-4 L15-L27），关系类型扩到 ≥7 种（任务验收 1，qa/tasks/P2-4 L15），厘清 missedNotice/noticeRules 边界，堵住归一化白名单缺口。
- 拟改文件 / 函数：
  - `cloudfunctions/healthApi/index.js`：`getDefaultFamilyScopes` L354-L381、`getDefaultNoticeRules` L387-L408、`getDefaultInviteRelations` L528-L535（4→≥7）、`isScopeEnabled/isRelationScopeEnabled/getScopeText` L552-L578（改为按动作判定 read/write/remind，参考设计稿 `hasScopePermission` L76-L94）、`normalizeFamilyAuthPayload` L683-L697 附近、`normalizeFamilyInvitePayload` L834-L854（**增加 scope key 白名单与字段级校验，拒绝 missedNotice 等非 scope 对象落库**）。
  - `cloudfunctions/healthApi/family-service.js`：`getFamilyInviteData` L267-L309（去掉第 5 个 scope missedNotice L296-L301，按第 5 节决策并入 noticeRules）、`getHomeFamilyData` L32-L172 的判定 L56-L59、`getFamilyAuthData` L374-L443。
  - `services/family.js`：`getRelationMeta` L33-L41、`getScopeText` L43-L47、`mapFamilyMember` L49-L61、`normalizeFamilyMember/normalizeFamilyAuth` L241-L297、四个 Local 镜像 L73-L183 的字段结构。
  - `services/page-data.js`：family/familyInvite/familyJoin/familyAuth/homeFamily 默认结构 L20-L21、L144-L147。
  - 页面：`pages/family-sub/family-invite/index.wxml`（二值 switch 改三级）、`family-auth/index.wxml` + `index.js`（L81-L92 notice 区块、L106-L127 saveAuth）、`pages/family/index.wxml` 成员卡片（L21-L78 注释块放开时同步新模型）。
  - 文档：`docs/云开发数据库Schema设计文档.md` L273-L278（enabled 示例）、L251（唯一约束表述）。
- 旧数据兼容：读路径对存量 `enabled` 做映射（设计稿 L24-L27、L99-L102：enabled=true → read:true, write:false, remind:true）；**是否做一次性 backfill 待第 5 节决策（线上存量待云控制台核查）**。
- 风险：双端版本并存期，旧客户端写 enabled、新云端读三级；映射必须双向且默认拒绝（缺字段按最小权限，不能默认全 true）。
- 验收：Jest 新增归一化矩阵用例（旧 enabled / 新三级 / 缺字段 / 非法 key / 全 false）；回归脚本 testFamilyService 通过；云控制台抽样存量文档兼容读。

### A1 多成员关系模型与改权/撤销精确性（安全基线）

- 目标：消除 seed-audit Q6 的批量误伤与撤销残留。
- 拟改文件 / 函数（cloudfunctions/healthApi/family-service.js）：
  - `updateFamilyAuth` L445-L518：**memberId 改为必填**（缺失即报错，禁止退化到 `{ownerOpenId,status:'active'}` 批量 where，L470-L502）；memberId 存在但关系行不存在时 auth 不得静默更新（当前同步 0 行无感知）。
  - `revokeFamilyMember` L697-L788：无 memberId 分支 L759-L782 补齐 family_members 处理（要么禁止、要么按当前 family_auth.memberOpenId 精确定位单条关系行置 revoked）；保证"撤销后 getFamilyAccessContext 立即返回 null"。
  - `createFamilyInvite` L520-L589：明确 family_auth 单文档语义或改为"一邀请一文档"（待第 5 节决策）；更新时显式处理 memberOpenId（重新邀请应清空或显式保留，不能依赖 update 合并残留，L539-L560）；status 翻转规则显式化。
  - `joinFamilyByInvite` L591-L695：配合新文档模型调整 upsert（L635-L692）。
  - `getFamilyData` L174-L265：成员列表 L181、auth limit1 L230 附近按新模型返回。
  - `cloudfunctions/healthApi/index.js`：`getFamilyAccessContext` L620-L659 的 limit 1 多 owner 取舍（L621-L628）——多 owner 是显式支持（返回可切换列表）还是显式拒绝（一人只绑一位老人，与 familyJoinHint 文案"只能绑定 1 位家属"是两个维度，需产品确认）。
  - 前端：`pages/family-sub/family-auth/index.js` L19（memberId 默认空串）、L39-L41（options.id 兜底）、L143（revokeAuth）；`pages/family/index.js` L89-L124（已传 id，保持）。
  - `settings-data-service.js` L175-L189、L674-L725：家属注销对 owner family_auth 的连带改写按新模型收敛。
- 风险：改文档模型涉及线上数据迁移与索引；memberId 必填会让旧客户端的改权/撤销请求失败（可接受的安全失败，但需版本兼容说明）。
- 验收：云端 Jest/回归新增矩阵——单成员/多成员改权互不影响、两分支撤销后 homeFamily 立即 403 化（返回无授权结构）、重复邀请不残留 memberOpenId、注销不波及无关成员。

### A2 邀请流程与枚举面

- 目标：邀请码生命周期可控；加入页枚举面最小化。
- 拟改：
  - `pages/family-sub/family-invite/index.js`：onLoad L29-L33 与 selectRelation/toggleScope/selectAll L50-L75 的**四次自动 createInvite 合并**——进入页面只查配置（getFamilyInviteData），显式"生成/刷新邀请"时才创建；分享前确保有有效码。
  - `family-service.getFamilyJoinData` L311-L372：错码/空码/撤销码显式区分错误（当前统一返回通用页 L359-L371）；评估频率限制与最小返回（ownerName 是否必须在加入前暴露，L335-L340）。
  - 邀请码：`createInviteCode` index.js L239-L243（实为 KXJ+9 字符共 12 位，修正文档表述）；配合控制台唯一索引（Schema L251）。
  - `family-join/index.js` L35-L45、L72-L97：错误码文案分支。
- 风险：频率限制可能误伤正常用户；错码报错改变现有"通用页"体验（当前可能是有意的防枚举设计，需产品确认方向）。
- 验收：回归用例覆盖 有效/错码/撤销/过期/空码/他人 active 码/自加入 拒绝矩阵；手工验证一次配置过程只产生一个有效码。

### A3 二级页家属态（read 闭环）

- 目标：家属从 homeFamily 进入趋势/记录/详情/用药列表后，数据主体始终是 owner，且只暴露 read 授权范围；无 write 时只读。
- 拟改：
  - 上下文传递：`pages/family-sub/home-family/index.js` L71-L115 所有 goRoute 出口携带 ownerOpenId（或进入家属态时在全局/缓存建立"家属会话"，二级页统一读取——建议显式参数 + 服务端不信任前端参数，见下条）。
  - 云端（**权威判定必须在云端**）：`record-service.js`（现全部 `_openid: openId`，如 L41/L51 等读函数）、`report-service.js`、`medication-service.js` L41/L51/L183/L225-L244 增加受控 owner 读分支：入参带 ownerOpenId 时先经 `getFamilyAccessContext`（index.js L620-L659）+ scope.read 校验，再以 ownerOpenId 查询；无关系/无 read 一律拒绝。
  - 页面：trend、recordList、recordDetail、medList 页面 onLoad 识别家属态，隐藏新增/编辑/删除/确认按钮（write=false）；`utils/pre-check.js` PROTECTED L207-L236 评估家属态路由规则。
  - `services/medication-merge.js` `mergeHomeFamilyMedicationStatus` L237-L256：家属态下不得用本机确认覆盖 owner 卡片（修 seed-audit 1.7 串扰）。
- 风险：二级页数量多、路由参数可能被篡改（所以服务端必须二次校验）；bpBg 复合指标（见 B4）影响家属态趋势契约。
- 验收：逐页手工 + 云端用例：家属有/无各 read scope 的字段矩阵；篡改 ownerOpenId 为无关系用户时拒绝；家属态无任何写按钮且直接调写 action 被拒。

### A4 代录通道（write 闭环）

- 目标：按第 5 节拍板的代录范围开放，默认最小授权。
- 拟改：
  - 云端写接口：index.js `saveBloodPressureRecord` L1162-L1181、`saveBloodGlucoseRecord` L1195-L1214、`deleteRecord` L1260-L1275（`assertOwnedDocument` L588-L595 需扩展为"本人或有 write 的家属"）；medication-service.js `saveMedicationPlan` L324-L352、`confirmMedication` L383-L432、`revokeMedicationConfirmation` L434-L441。
  - 记录代录审计字段：数据归属仍写 ownerOpenId（`_openid` 语义需确认云数据库"_openid 由平台写入"的约束——家属端云函数内 add 时 `_openid` 默认是调用者，**需验证云函数端显式指定 ownerOpenId 字段的可行性，必要时新增 ownerOpenId 业务字段而非复用 _openid**，这是本阶段最大技术待验证点）。
  - 前端：home-family 与二级页按 scope.write 显示代录/代确认入口；`utils/api.js` L356-L359 写门面扩展。
- 风险：代录归属错误是数据事故；删除/计划变更比新增更敏感（建议本期不开放计划增删改）。
- 验收：负向用例（无 write 代录被拒、撤销后代录被拒、代录到无关系 owner 被拒）；正向用例（owner 端可见代录记录与代录者标识）；回归全绿。

### A5 撤销实时生效、镜像与缓存一致性

- 拟改：
  - `services/family.js`：`createFamilyInviteLocal` L109-L144 补 expiresAt；`joinLocal` L146-L157 补过期校验；`revokeLocal` L159-L183 去掉 `slice(1)` 兜底 L163-L165，改为按 memberId 精确撤销。
  - `services/core.js`：`requestCloudByKey` 失败 allowStale 分支 L237-L239 补 TTL/关键 key（homeFamily/familyAuth）禁用旧缓存；评估撤销后家属端下次请求 403 时主动清本地 family_auth_v1 与云读缓存。
  - 与 A1 的云端撤销修复联动验收。
- 风险：弱网下家属端短时残留（内存缓存最长 TTL 60s，core.js L24）需在产品文案中说明；不得为了"即时"让前端镜像参与授权。
- 验收：构造"撤销瞬间家属端停留在 homeFamily/二级页"场景手工验证；Jest 补四个 Local 镜像用例（当前零覆盖，family.test.js L327-L355）。

### A6 家属 remind 推送

- 拟改：
  - `cloudfunctions/sendDueReminders/index.js`：owner 枚举 L360-L394 之后增加 family_members 扫描（active + 对应 scope.remind + noticeRules 类型开关）；`sendSubscribeMessage` L138-L142 增加 memberOpenId 收件人分支；模板 L28-L36 新增漏服/未记录家属模板（**模板需微信平台申请，待第 5 节决策**）。
  - 家属端订阅授权入口（新页面或 family-auth/home-family 内入口），复用 `utils/subscribe.js` 的 requestSubscribeMessage 与配额记录；配额按 memberOpenId 记账的集合设计。
  - noticeRules 与 scope.remind 双判定；reminder_push_logs（L25）去重键区分收件人。
  - config.json L6 触发器频率复核（每分钟）。
- 风险：订阅消息模板审核周期；家属未授权时无法触达（平台限制，需文案引导）。
- 验收：构造 owner 漏服 + 家属 remind 开关的端到端用例（需测试环境模板）；去重与开关关闭时不推送的用例。

### A7 Tab 放开、死页、回滚开关与合规

- 拟改：
  - `pages/family/index.wxml` L14-L20 占位与 L21-L78 注释块按最终 UI 放开；`pages/family/index.js` 既有逻辑接线。
  - 死页 `pages/family-sub/index.js`（L12-L22）：删除或在 `utils/routes.js` L33-L37 注册并接线（待决策）；同步 `app.json` L52。
  - 回滚开关：设计稿 featureFlags（qa/designs/P2-4 L104-L108）在运行时代码中不存在（grep 仅 qa 文档命中）——建议用云配置（如 privacy_settings 同级远程开关）或前端常量 + 云端 action 开关双保险，确保可远程关闭家庭入口。
  - 合规文案复核：static-pages.js L62-L65（不提供诊断/治疗/处方/用药决策/急救/互联网诊疗）、L88-L92、L164-L167、familyJoinHint L217-L222；home-family wxml L92、family-auth wxml L75 notice-bar；代录场景需补"代录数据由家属填写，不构成诊疗建议"类文案（法务/产品确认）。
- 验收：真机走查 owner 与家属双角色全链路；回滚开关关闭后 Tab 回到占位且云端 action 拒绝。

---

## B. 影响本次验证的历史问题（护栏，建议先行）

| 编号 | 问题 | 拟改文件 / 位置 | 验收 |
|---|---|---|---|
| B1 | 回归脚本在用药用例崩溃（读已删除字段 `todayLogs`，真实为 `todayCards`），testFamilyService/testSettingsDataService 整段未执行 | `scripts/health-api-regression.js` L295（main L521-L527；跳过 L318-L430、L432-L519） | 修复后 `npm run regression` 跑完所有用例并输出真实通过/失败数 |
| B2 | 回归脚本复制了一份 getScopeText/isRelationScopeEnabled/getDefault*/normalize*（L172-L232、约 L387-L406），与云端实现两份会漂移 | 同上；必要时把 index.js 的纯函数导出供脚本 require | 三级模型改造只改一处，脚本自动跟随 |
| B3 | Jest 不覆盖 cloudfunctions（package.json L23-L27 仅 services/utils），云端权限逻辑零单测 | 新增 cloudfunctions 测试工程（mock wx-server-sdk）或扩展 testMatch/collectCoverageFrom | A1/A3/A4 的安全负向用例可自动化执行 |
| B4 | 趋势页 2 个失败测试（tests/unit/page-data-consistency.test.js L36/L50，旧契约 3 指标 vs 现 bpBg 复合指标） | 测试契约或 services/page-data.js trend 默认值，二选一（待第 5 节决策） | `npm test` 全绿；家属态趋势以同一契约设计 |
| B5 | 回归 mock db 仅支持等值与 `_.in`（L150-L157），remove 不按条件（L81-L85），范围查询/批量删分支不可信 | scripts mock 实现 | 趋势范围查询、撤销/注销批量删可在 harness 中断言 |
| B6 | eslint 不扫 cloudfunctions/scripts/tests（package.json L11） | 独立 eslint 配置或扩 target | 云端改动进入 lint 范围；本轮基线 12 error/34 warning 先建台账不扩散 |

> 说明：B 类中 B1/B2/B3 强烈建议在 A0 之前完成——否则三级权限改造期间没有任何能跑通的云端自动化验证，只能靠手工与真机。

---

## C. 可延期的无关问题

1. 云函数运行时 Nodejs16.13（cloudbaserc.json L11/L21）→ Node 18 升级（任务稿 P0-2），独立前置项，需回归全绿后单独部署验证。
2. 文档残留旧绝对路径 `D:/CursorWorkspace/xiaochengxu`：Schema L524、初始化清单 L219/L228、项目结构阅读指南多处（L21/L76-L91/L123/L216 等）。
3. 阅读指南 L90 引用的 `utils/mock-data.js` 已不存在；本地默认数据实际在 `services/page-data.js` 的 DEFAULT_PAGE_DATA（core.js L285-L290 懒加载）。
4. 根目录 `service-regression-test.txt` 用途待确认（project.config.json L115 打包忽略、无 npm script 引用），确认后归档。
5. `npm test` 未启用覆盖率阈值（package.json L8 vs L28-L35 thresholds），可在 CI 接 test:coverage。
6. 云函数错误响应是否向客户端回传堆栈/内部细节（index.js main catch 区段，实施时顺带复核最小化）。
7. lint 基线 12 error / 34 warning（evidence/00-baseline/2026-09-21/lint.txt）建台账逐步清零，本期不跑 lint:fix、不夹带修改。

---

## 5. 待用户拍板的业务选择（同 seed-audit 第 4 节，实施前必须确认）

1. 代录范围：仅代确认 / 含血压血糖代录 / 含用药计划增删改（建议：仅代确认 + 血压血糖代录，计划只读）。
2. 多家属文档模型：family_auth 维持 owner 单文档，还是改"一邀请一文档"/"一成员一文档"（决定 A1 修法与迁移成本）。
3. read 粒度：四块开关是否够用，是否需要字段/时间范围子粒度。
4. remind 语义与 noticeRules 的关系；家属订阅入口位置；是否新申请订阅模板。
5. missedNotice 并入 noticeRules（建议）还是保留独立 scope。
6. 关系类型最终名单（验收 ≥7 种；设计稿 8 种 L34-L43）。
7. 旧 enabled 数据是否 backfill（线上存量需云控制台先查）。
8. 死页 family-sub/index 删除还是接线。
9. 邀请错码策略：显式报错（体验清晰）还是维持通用页（防枚举）；是否加频率限制。
10. 一个家属是否允许关联多位老人（当前 limit 1 只支持最近一位）。
11. Node18 升级是否纳入本期。
12. 趋势测试契约以 bpBg 新模型为准更新测试（建议），还是回退默认数据。

> 技术待验证（非业务选择，但影响 A4）：云函数中以家属身份 add 数据时 `_openid` 的归属规则——需先在测试环境验证能否显式写 owner 的 _openid，否则代录数据需用独立 ownerOpenId 业务字段并改造全部查询。

---

## 6. 建议的验收矩阵（实施阶段使用）

- 角色：owner、家属 A（全 read + write + remind）、家属 B（仅部分 read）、无关系用户、已撤销家属。
- 动作：邀请（生成/刷新/过期/撤销/重复）、加入（6 种码状态）、查看（homeFamily + 五个二级页 × 四个 scope）、代录（BP/BG/确认/撤销确认/计划，按授权）、改权（单成员精确、多成员互不影响）、撤销（两分支 × 即时性 × 弱网缓存）、注销/导出（双向）、提醒（owner 本人/家属/开关组合/去重）。
- 护栏：`npm test` 全绿（含新增云端用例）、`npm run regression` 跑完全部用例、lint 不新增 error、真机双端版本并存走查、回滚开关演练。
