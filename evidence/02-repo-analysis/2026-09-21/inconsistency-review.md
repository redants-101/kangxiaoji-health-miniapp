# 阶段 2 · 旧报告与基线问题复核对照（inconsistency-review）

- 复核日期：2026-09-21
- 被复核材料：`docs/家庭Tab开放与三级权限只读分析.md`（2026-08-11，335 行，下称"旧报告"）；历史基线 `evidence/00-baseline/test-results.md`（2026-08-11，Node v20.16.0）
- 复核方式：以旧报告为线索回到当前代码（HEAD `a751776`）逐条核验，行号均为本轮实测；不复制旧报告结论。
- 状态标记：**仍成立** / **需修正** / **缺证据（本轮已补）** / **需运行验证** / **待人工确认**。
- 环境声明：本期基线在豆包会话自带 Node v22.23.2 / npm 10.9.8 下复跑（见 `evidence/00-baseline/2026-09-21/environment.md`），旧基线为 Node v20.16.0。两版基线三项检查现象**完全一致**（见第 3 节），差异不能归因于 Node 版本或模型变化，属代码/测试自身状态。

---

## 1. 旧报告论断逐条复核

### 1.1 第 0 节（范围与结论性判断）

| 旧报告位置 | 论断 | 状态 | 本轮证据 / 修正 |
|---|---|---|---|
| L11 | dataSource 'cloud'（引 api-config L8-L12） | 仍成立（行号小漂移） | `utils/api-config.js` L9 `dataSource:'cloud'`、L10 `cloudFunctionName:'healthApi'` |
| L12 | Tab 已注册但 coming-soon 占位（app.json L101-L106；wxml L14-L20） | 仍成立（行号小漂移） | tabBar family 项实际在 `app.json` L102-L105；占位 `pages/family/index.wxml` L14-L20，真实 UI 注释于 L21-L78 |
| L13 | 读侧已有跨账号鉴权 family_members→ownerOpenId+scopes（family-service L32-L172、index L620-L659） | 仍成立 | 本轮逐行复核：`getFamilyAccessContext` index.js L620-L659；`getHomeFamilyData` family-service.js L32-L172（scope 判定 L56-L59，查询 L80/L101/L113） |
| L14 | 写侧完全没有家属通道 | 仍成立 | 见 1.4 节复核；所有写接口 `_openid: openId` 写死 |
| L15 | 仅 enabled 两级，三级只有设计稿 | 仍成立 | index.js L354-L381、L552-L578；services/family.js L43-L47；全仓无 read/write/remind 运行时代码 |
| L16 | 合规边界文案 static-pages L62-L65 | 仍成立 | static-pages.js L62-L65（不提供诊断/治疗/处方/用药决策/急救/互联网诊疗）；另补 L88-L92、L164-L167 家庭共享条款 |

### 1.2 第 1 节（调用链）

| 旧报告位置 | 论断 | 状态 | 本轮证据 / 修正 |
|---|---|---|---|
| L27 | 真实成员列表在注释块 L21-L77 | 需修正（行号） | 注释块结束于 **L78**（`-->` 在 L78），即 L21-L78 |
| L28 | family-sub/index 是注册但无入口的孤立页 | 仍成立 | `app.json` L52 注册；`pages/family-sub/index.js` L12-L22 仅 3 个跳转按钮；routes.js L33-L37 无该页键，全仓无跳转引用 |
| L29 | 邀请页 onLoad 即创建、切换关系/权限再次创建 | 仍成立 | family-invite/index.js onLoad L29-L33（L32 调用）；selectRelation L50-L56、toggleScope L58-L68、selectAll L70-L75 均再次 createInvite（L89-L104） |
| L33 | home-family 跳转 trend/medList/medConfirm/recordList | 仍成立 | 出口行号：home-family/index.js L71-L73、L80-L82、L89-L95、L108-L110、L113-L115，**均不带 ownerOpenId** |
| L35 | 路由集中 routes.js L32-L37；分包 app.json L48-L59 | 仍成立（行号小漂移） | family 主键 L10；子页键 L33-L37；分包块 L49-L59 |
| L39-L42 | api.js 家庭导出 L335-L359 | 仍成立（精确化） | 读：L322（hint）、L325/L257-L262（homeFamily）、L335-L338；写：L356-L359 |
| L44 | enforceHomeFamilyAccess 只查本地 family_auth_v1，云端 family_members 才是权威 | 仍成立 | services/family.js L202-L210；本地镜像 null 时直接放行（L204），不可作授权依据 |
| L48 | mirrorLocal「云端成功后镜像写本地」L320-L342 | 仍成立 | services/family.js L320-L342 |
| L49 | 读 60s 内存缓存、写成功清缓存（core L225-L290） | 仍成立（补充） | cloudReadCache 内存变量 core.js L22、TTL L24；写成功 clearCloudReadCache L194（定义 L94-L96）；**补充：失败 allowStale 兜底不校验 TTL（L237-L239），旧报告未提** |
| L50 | DIRTY_MAP familyAuth 标记三页脏（L27-L38） | 仍成立 | familyAuth 映射在 core.js L32；getRelatedCacheKeys L115-L129（L121） |
| L51 | data-rights 把 familyAuth 纳入快照（L21） | 仍成立 | services/data-rights.js L21 |
| L57-L58 | keyMap/actionMap 行号区间 | 仍成立（本轮抽查） | familyJoin 在 keyMap L1344（本轮亲验）；actionMap 区间沿用旧报告，未逐行重数 |
| L60 | getOpenId 取 event.userInfo.openId，除 rebuildRecordStats 外失败抛错 | 仍成立 | index.js L208-L214；main L1285-L1297（豁免 L1291-L1296）。**运行时平台是否必然注入仍属待运行验证（关联 P0-1）** |
| L64-L73 | 集合清单 L41-L53；双写；push_logs | 仍成立（补充） | COLLECTIONS 实际 11 个（L41-L53）；**reminder_push_logs 不在该常量，由 sendDueReminders L25 直引**；family_auth/family_members 双写见 updateFamilyAuth L445-L518 |
| L75 | updateFamilyAuth 按 ownerOpenId 或 memberId 批量同步 | 仍成立（风险坐实） | 无 memberId 时 where 退化为 `{ownerOpenId,status:'active'}` 批量更新全部家属（family-service.js L476-L502） |

### 1.3 第 2 节（占位原因与风险）

| 旧报告位置 | 论断 | 状态 | 本轮证据 / 修正 |
|---|---|---|---|
| L83-L85 | 有意的前端开关，JS 逻辑完整 | 仍成立 | wxml L14 注释明确"上线后移除 coming-soon"；family/index.js L29-L143 功能完整 |
| 2.2-1（L89） | 三级权限未落地 | 仍成立 | 同 1.1-L15；另：设计稿的 featureFlags 回滚开关在运行时代码中不存在（grep 仅 qa 文档命中） |
| 2.2-2（L90） | 无代录后端通道，家属提交写到自己名下 | 仍成立 | index.js saveBP L1162-L1181（_openid L1171）、saveBG L1195-L1214（L1204）、deleteRecord L1260-L1275；medication-service L324/L352、L383/L393/L420、L434-L441 |
| 2.2-3（L91） | 二级页按本人 openId 查询，家属看到空白/自己数据，"造成越权/混淆" | **需修正定性** | 现象成立（home-family L71-L115 不带 owner 上下文；record-service/report-service grep 零 family 字样）。但家属看到的是**本人数据**，读不到 owner——性质是**漏权 + 数据主体混淆**，不是越权读取 owner；旧报告"越权"用词在此场景不成立（其 2.3 对"未来加代录不补鉴权会越权"的前瞻判断成立） |
| 2.2-4（L92） | family-sub/index 死页 | 仍成立 | 同 1.2-L28 |
| 2.2-5（L93） | onLoad/切换反复 createInvite 会"把已有邀请/已加入关系的 scopes 意外重置" | **需修正影响范围** | 反复 upsert 属实（family-service L520-L589，新码覆盖、status 回 pending、expiresAt 重置 L549）。但 createFamilyInvite **只写 family_auth，不直接改 family_members**：已加入家属的关系行与访问能力不被该动作重置；被重置的是 owner 邀请文档/ownerPreview/scopes 展示。另补：update 合并语义使旧 memberOpenId 残留（inviteData 不含该字段，L539-L551） |
| 2.2-6（L94） | family_auth 单文档限制多家属；revoke 同步条件苛刻 | 仍成立（补充两点） | ① 重新邀请不清 memberOpenId（同上）；② **getFamilyAccessContext 对一个家属关联多个 owner 只取 updatedAt 最新一条（index.js L621-L628 limit 1），其余 active 关系不可达**，旧报告未提 |
| 2.2-7（L95） | noticeRules 存在但定时推送只发本人 L284-L358 | 仍成立（补充） | owner 枚举 sendDueReminders L360-L394；sendSubscribeMessage touser=本人 L138-L142；模板仅 3 个 L28-L36；**全仓 grep noticeRules 在定时函数零命中；家属端无订阅授权入口；触发器 config.json L6 每分钟** |
| 2.3 越权读（L99） | record/report service 无 family 概念 | 仍成立（定性同 2.2-3） | grep 两文件 family/ownerOpenId/memberOpenId 零命中；当前为漏权，代录上线时才转化为越权风险 |
| 2.3 越权写（L100） | 写接口无家属校验，开放按钮必须补服务端鉴权 | 仍成立 | 同 2.2-2；另补技术待验证点：云函数中家属身份 add 文档时 `_openid` 的平台写入规则需先验证，可能需独立 ownerOpenId 业务字段 |
| 2.3 邀请码（L101） | "仅 8 位 base36 时间+随机"；无尝试限制；无唯一索引（Schema L433）；getFamilyJoinData 凭码返回 ownerName/scopes（L311-L358） | **需修正** | ① 邀请码实为 **`KXJ`+4 位时间 base36+5 位随机 base36，共 12 字符**（createInviteCode index.js L239-L243；Schema 示例 KXJABCD12345 在 L305，同为 12 字符）；② 唯一约束表述实际在 **Schema L251**（非 L433），代码无索引创建逻辑、线上是否已建待人工确认；③ getFamilyJoinData 实际区间 L311-L372，**错码/空码不报错而返回通用默认页（L359-L371）**，旧报告未提；无尝试次数限制属实 |
| 2.3 updateFamilyAuth（L102） | memberId 为空批量更新 owner 全部家属；family-auth 新建场景不传 id（L109-L115） | 仍成立 | family-service.js L470-L502；family-auth/index.js memberId 默认 ''（L19）、onLoad `options.id||''`（L39-L41）、saveAuth 原样上送（L109-L115）。另补：memberId 存在但关系行不存在时 auth 仍更新、members 同步 0 行静默（L496-L504） |
| 2.3 revoke（L103） | 无 memberId 分支撤的是 owner 自己的 family_auth；family-auth 空串会整体撤销 | 仍成立（后果坐实） | family-service.js L759-L782 只改 family_auth、不碰 family_members；而 getFamilyAccessContext 先查 family_members（index.js L621-L636）——**撤销后家属关系行仍 active，homeFamily 仍可读 owner，撤销形同未撤**；有 memberId 分支正确（L700-L756，auth 同步条件 L737-L745） |
| 2.3 本地缓存（L104） | wx.storage 不可作授权源，云端再查关系的架构方向正确 | 仍成立 | 补充弱网残留路径：云端失败时 stale 内存缓存不校验 TTL（core.js L237-L239）；本地镜像无 expiresAt/过期校验（family.js L124-L157） |
| 2.3 合规（L105） | 两处 notice-bar；代录不得新增建议/判断输出 | 仍成立 | home-family/index.wxml L92、family-auth/index.wxml L75；static-pages.js L62-L65 |

### 1.4 第 3 节（入口与身份校验现状）

| 旧报告位置 | 论断 | 状态 | 本轮证据 / 修正 |
|---|---|---|---|
| 3.1 表 L115 | homeFamily 受控，过滤 bp/bg/medicine/report（L56-L116） | 仍成立 | 判定 L56-L59（别名兼容 bp/bloodPressure 等）；records L80、plans L101、confirmations L113；块级过滤、无行级过滤 |
| 3.1 表 L116-L120 | 五个二级页入口全部无家属鉴权 | 仍成立 | home-family/index.js L71-L115；medication-service 读 L41/L51/L183/L225-L226/L244 |
| L121 | 跨账号读只有 homeFamily 一条受控路径 | 仍成立 | 本轮全量 grep 复核，无第二条 |
| 3.2 表 L127-L131 | 五个写接口行号与"无代录通道"结论 | 仍成立 | 行号全部本轮复核一致（saveMedicationPlan 更新归属校验 L183/L225-L226，新增 _openid L352） |
| 3.3 L139 | "至少一个 scope enabled"校验在 index L839-L841 | 仍成立（行号小漂移） | normalizeFamilyInvitePayload 位于 L834-L854；**另补：只按 item.key 过滤、无 key 白名单，missedNotice 等任意 key 可当 scope 落库** |
| 3.3 L140 | getFamilyJoinData"无需登录态即可按 inviteCode 查询"（keyMap L1344 不传 openId） | **需修正** | service 签名确实不收 openId（family-service L311；keyMap L1344），但 main 对所有请求统一先 getOpenId（index.js L1289-L1297，仅 rebuildRecordStats 豁免），无 openid 在路由前即抛错。正确表述：**"任意已登录用户均可查询，不校验其与邀请的关系"**——枚举面结论不变，"无需登录态"不成立 |
| 3.3 L141 | 加入五项校验（L602-L619），upsert members 并置 auth active | 仍成立 | 不存在 L603-L605、revoked L606-L608、他人 active L609-L611、过期 L612-L614、自己 L617-L619；member upsert L635-L638、auth active L680/L691-L692 |
| 3.3 L142 | updateFamilyAuth 无 memberId 批量更新 | 仍成立 | 同 2.3 |
| 3.3 L144 | clearUserAccount L705 调 updateFamilyAuthByMember 连带撤销 | 仍成立（精确化） | 函数定义 settings-data-service.js L175-L189；clearUserAccount L674-L725（双向删 family_members、撤 family_auth）。**补充多家属连带：家属注销会把 owner 的 family_auth 单文档整体置 revoked，影响其他 active 家属的 ownerPreview** |
| 3.4 L148 | pre-check PROTECTED L207-L229、PROFILE_FREE L238-L244；只校验 onboarding | 仍成立（行号小漂移） | PROTECTED 实际 L207-L236（home-family L209、family L218、invite L219、join L220、auth L221）；PROFILE_FREE L238-L244（join-hint L242、join L243）；不校验家属身份属实 |

### 1.5 第 4 节（兼容方案）

| 旧报告位置 | 论断 / 建议 | 状态 | 本轮证据 / 修正 |
|---|---|---|---|
| L160-L168 | 旧 enabled 结构出现位置 | 仍成立（一处补充） | 默认值 index.js L354-L381；邀请页 family-service L271-L302（**实为 5 项**，含 missedNotice L296-L301）；page-data.js 本地 familyInvite 默认 scopes 为空数组（L144），云端返回后 wxml `wx:for` 才渲染出 5 行；鉴权/展示/校验行号同前 |
| L172-L179 | 设计稿映射 enabled→read+remind、write=false；hasScopePermission 草稿（L76-L86） | 仍成立（行号小漂移） | 设计稿映射 L24-L27；草稿 L76-L94；兼容 L99-L102 |
| 4.3 建议 1-8 | 统一 normalizeScope、鉴权替换、写入升级、读取兼容、本地同步、noticeRules 与 remind 双维度、本地补过期校验、回归加用例 | 方向成立，已吸收为本期 A0/A5/A6/B 计划 | 一处顺序调整：本轮建议先恢复回归护栏（B1-B3）再动模型；本地过期缺失复核属实（family.js createInviteLocal L109-L144 无 expiresAt、joinLocal L146-L157 无校验） |
| L192 | 云端 expiresAt 24h（L549）、join 校验 L612-L614 | 仍成立 | family-service.js L549、L612-L614；**注意 join 仅在 expiresAt 存在时判过期，旧码可能永不过期（任务稿 L20 亦提及），与设计稿 L100 一致但属待确认兼容口径** |
| L198 | getFamilyJoinData 无 expiresAt 时按 now+24h 展示（L341） | 仍成立（补充） | remainHours 计算 L341-L342；**错码通用页同样带 24h remainHours（L359-L371），不构成有效性证明** |
| 4.4 | 线上存量未知、无迁移脚本 | 仍成立，待人工确认 | 仓库内无迁移脚本/快照；需云控制台核查 family_auth/family_members 存量与安全规则 |

### 1.6 第 5 节（实施阶段清单）

- 阶段 A-G 的依赖方向（权限模型 → 代录后端 → 家属读覆盖 → UI → remind → 放开 Tab → 测试文档）**总体合理**，本轮 `file-impact-list.md` 在此基础上的调整：
  1. 新增 **A1 多成员关系模型与改权/撤销精确性**作为独立安全基线阶段（旧报告把它散在 2.3 风险里，未列为显式阶段）；
  2. 顺序上把**家属 read 闭环（旧阶段 C）提到 write 代录（旧阶段 B）之前**——二级页家属态是代录的载体，且 read 修复风险更低、可独立验收；
  3. 新增前置护栏 **B1-B3**（回归脚本 L295 崩溃修复、停止复制逻辑、云端纳入 Jest），否则 A 阶段没有可跑通的自动化验证；
  4. 新增 A7 回滚开关（featureFlags 仅存设计稿、运行时不存在）与邀请流程改造（反复创建、枚举面）。
- 旧报告 L217 "用药计划写不建议开放给家属"与本轮建议一致（仅代确认 + BP/BG 代录，计划只读，待产品拍板）。
- 旧报告 L218 提到 `services/records.js`、`services/medication-confirm.js` 传 ownerOpenId：本轮未把这两个 service 列入 A4 细目（写门面主要经 utils/api.js 与云端），实施时需再核对前端 service 写路径（**标缺证据，实施阶段补**）。

### 1.7 第 6 节（不一致项）

| 旧报告位置 | 论断 | 状态 | 本轮证据 / 修正 |
|---|---|---|---|
| 6.1 L257 | Jest 收集 services/utils 覆盖率、阈值 branches60/functions70/lines70、不含 cloudfunctions | 仍成立（补充） | package.json L23-L27、coverageThreshold L28-L35（**另有 statements 70 L33**）；**`npm test` 是 `jest --verbose`（L8）不带 --coverage，阈值在默认测试命令中不生效**，旧报告未提 |
| 6.1 L258 | 回归脚本内重新定义 getScopeText/isRelationScopeEnabled/getDefault*/normalize*（L172-L232），两份会漂移 | 仍成立（精确化） | 复制的默认/判定函数在 L172-L203；normalizeFamilyAuthPayload/normalizeFamilyInvitePayload 在 testFamilyService 内联复制（约 L387-L406）；另有简化版 validate*（L212-L232） |
| 6.1 L259 | routes-consistency 不测死页 | 仍成立 | test.txt L613-L619 该套件 5 个用例均为路由存在性，无 family-sub/index 引用断言 |
| 6.1 L260 | family.test 不覆盖四个本地镜像 | 仍成立 | test.txt L327-L355 仅纯函数 + enforce/getNoAccess 用例 |
| 6.1 L261 | 无"家属不能写/无 read 不返回字段"安全断言 | 仍成立 | 本轮逐套件核对，无此类负向用例 |
| 6.2 L265-L267 | lint 只扫 services/utils/pages/components，云端无 lint | 仍成立 | package.json L11（lint:fix L12，本期禁跑） |
| 6.2 L266 | console 警告例（api.js L189-L192） | 未逐条复核 | 不影响结论；基线 lint 明细见 2026-09-21/lint.txt（46 问题 12 error/34 warning，与 08-11 相同） |
| 6.3 L271 | service-regression-test.txt 无 script 引用、打包忽略、用途不明 | 仍成立 | 文件在仓库根；project.config.json L115 packignore；package.json 无引用，用途仍待确认 |
| 6.3 L272 | mock matches 仅支持等值与 _.in（L150-L157），不支持 gte/lte/and | 仍成立（补充） | 本轮复核 matches 仅 eq + `__op:'in'`；另补 mock `where().remove()` 不按查询条件过滤（L81-L85 区段），批量删断言不可靠 |
| 6.4 L276 | Schema L273-L278 仍 enabled | 仍成立 | 与三级设计稿不一致，列入 A0 文档更新 |
| 6.4 L277 | Schema L524 旧绝对路径 D:/CursorWorkspace | 仍成立 | 初始化清单 L219/L228、项目结构阅读指南多处同样残留 |
| 6.4 L278 | 初始化清单未读取 | **缺证据（本轮已补）** | 清单 L16-L19 列新增集合 family_members/health_daily_stats/health_record_stats/reminder_push_logs（family_auth 不在新增列）；L37-L41 要求 family_members 等仅云函数读写；**仓库无数据库安全规则文件，线上配置待人工在云控制台确认** |
| 6.4 L279 | P2-4 任务 4 功能点仅部分实现 24h | 仍成立 | qa/tasks/P2-4 L5-L9 功能点、L14-L20 六项验收；本轮核对仅"邀请 24h"部分落地（且本地不校验），关系扩展/三态/校验/家属提醒均未做 |
| 6.5 L283 | cloudbaserc Nodejs16.13（L7-L13） | 仍成立（行号小漂移） | envId L2；两函数 runtime Nodejs16.13 在 L11、L21；P0-2 Node18 状态待确认 |
| 6.5 L284 | project.config L71-L73 忽略 cloudfunctions，云函数需单独部署 | 仍成立 | 打包忽略在 L71 附近；云函数与小程序不同步发布的提醒有效 |
| 6.5 L285 | app.js L37 硬编码 env，与 cloudbaserc L2 一致 | 仍成立 | app.js L36-L40（env L37、traceUser L38） |
| 6.5 L286 | family-sub/index 注册但 routes 无键 | 仍成立 | 同前 |
| 6.5 L287 | tabBar 4 图标齐全 | 未复核 | 不影响家庭权限结论，实施 Tab 放开时真机核对 |
| 6.5 L288 | invite wxml 与云端均展示 5 个 scope（含 missedNotice），默认值只有 4 个，会当 scope 落库 | 仍成立（精确化） | 云端 getFamilyInviteData 确为 5 项（family-service L271-L302，missedNotice L296-L301）；**本地默认 familyInvite.scopes 为空数组（page-data.js L144），wxml 用 wx:for 渲染——cloud 数据下显示 5 行（含"未确认提醒"），与 noticeRules 区块概念重复**；落库路径成立：normalizeFamilyInvitePayload 无白名单（index.js L834-L854） |
| L234 | 定时模板只有 3 个（引 L28-L32） | 仍成立（行号小漂移） | 模板定义 sendDueReminders L28-L36 |

### 1.8 第 7-8 节（索引与节奏）

- 索引行号本轮整体复核结果：除上文已列明的修正（邀请码长度、Schema L433→L251、getFamilyJoinData L311-L358→L311-L372、注释块 L77→L78、api-config L8-L12→L9-L10、app.json tabBar L101-L106→L102-L105、pre-check L207-L229→L207-L236）外，其余引用准确。
- 第 8 节"每步三检查全绿"的门槛当前**不具备条件**：regression 在用药用例即崩溃（见第 2 节），必须先修 B1。

---

## 2. 本轮新增发现（旧报告未覆盖或未坐实）

1. **撤销残留访问可利用链坐实**：无 memberId 撤销不改 family_members（family-service L759-L782），而 access context 以 family_members 为第一可信源（index.js L621-L636）——撤销后家属仍可读 homeFamily。旧报告只描述了"撤错文档"，未给出"访问权仍然有效"的后果链。
2. **改权静默失败路径**：memberId 存在但关系行不存在时，family_auth 更新成功、family_members 同步 0 行无报错（family-service L496-L504）。
3. **多 owner 家属只认最近一位**：getFamilyAccessContext orderBy updatedAt desc limit 1（index.js L621-L628），无切换机制。
4. **错码返回通用页**：getFamilyJoinData 对空码/错码不报错（family-service L359-L371），且通用页带默认 scopes 与 24h remainHours，客户端无法区分码是否有效。
5. **memberOpenId 残留**：createFamilyInvite 更新邀请文档时 inviteData 不含 memberOpenId（family-service L539-L551），doc.update 合并导致旧成员 openId 残留到新邀请。
6. **家属注销连带撤 owner 单文档**：settings-data-service L175-L189、L697-L717 区段，多家属下影响面超出本人关系。
7. **显示串扰（待运行验证）**：mergeHomeFamilyMedicationStatus 用本机最新确认按 logId 覆盖 owner 卡片状态（medication-merge L237-L256；api.js L261）。
8. **失败兜底不校验缓存 TTL**：core.js L237-L239 allowStale 分支。
9. **featureFlags 回滚开关无运行时实现**：grep 全仓仅 qa/*.md 命中。
10. **文档漂移新增项**：阅读指南 L90 引用的 utils/mock-data.js 已不存在（本地默认数据实际在 services/page-data.js DEFAULT_PAGE_DATA，core.js L285-L290 懒加载）；COLLECTIONS 11 个集合与 push_logs 的关系旧报告未说明。
11. **npm test 默认不触发覆盖率阈值**（package.json L8 vs L28-L35）。
12. **邀请配置过程产生 N 个邀请码**：onLoad + 3 类交互各创建一次（family-invite/index.js L32/L55/L67/L74），旧报告只说"会再次创建"，未量化为 4 个创建点。
13. **定时触发器频率**：config.json L6 `0 * * * * * *`（每分钟），旧报告未引用。
14. **关系类型缺口量化**：代码仅 4 种（index.js L528-L535、family.js L34-L39），设计稿 8 种、验收要求 ≥7（qa/designs L34-L43、qa/tasks L15）。

---

## 3. 基线问题复核（2026-08-11 vs 2026-09-21）

### 3.1 三项检查跨版本对照

| 检查 | 2026-08-11（Node v20.16.0，test-results.md） | 2026-09-21（Node v22.23.2，本期 evidence/00-baseline/2026-09-21） | 结论 |
|---|---|---|---|
| npm test | 退出码 1；16 套件 15 过 1 败；357 用例 355 过 2 败（L13-L24） | 退出码 1；16 套件 15 过 1 败；357 用例 355 过 2 败（test.txt L621-L625） | **现象完全一致** |
| 失败位置 | page-data-consistency：metricOptions 期望 3 项实得 [bpBg, medication]；activeMetric 期望 bloodPressure 实得 bpBg（L23-L24） | 同一文件 L36/L38/L50 断言失败（test.txt L568-L611） | **同一失败，无变化** |
| npm run lint | 退出码 1；46 问题（12 error/34 warning），集中在未使用变量与宽松相等（L36-L47） | 退出码 1；46 问题（12 error/34 warning），明细见 lint.txt | **现象完全一致**；旧基线特别标注 services/family.js 未使用的 writeStorage 导入（test-results.md L48），实施 A0/A5 时顺带确认 |
| npm run regression | 退出码 1；L295 `Cannot read properties of undefined (reading '0')`，testMedicationService 崩溃（L58-L66） | 退出码 1；同一 TypeError、同一位置 L295:36、main L523（regression.txt 全文） | **现象完全一致** |

- 两次基线间隔 41 天、Node 大版本不同（v20→v22），三项失败现象与计数完全一致，且 HEAD 自 2026-08-10 起未变动（a751776）。**这些失败不能归因于 Node 版本升级或模型差异，是仓库自带的代码/测试漂移**；本期审计未修改任何业务文件，失败与本期活动无关。

### 3.2 两个失败测试对家庭读路径的影响判定

- 失败断言对象：`DEFAULT_PAGE_DATA.trend`（services/page-data.js），校验趋势页指标模型（旧 3 指标 bloodPressure/bloodGlucose/medication vs 现合并模型 bpBg/medication）。
- 与家庭读路径的代码交集：**无**。homeFamily 走云端 family-service.getHomeFamilyData（family-service L32-L172）与独立默认结构 page-data.js L20；趋势服务 getTrendData 及其单测已按 bpBg 实现并通过（test.txt L63-L79，含 L67"metricOptions 包含 bpBg 和 medication"、L75"bpBg 复合指标返回双图表"）。
- 判定：**不影响家庭受控读链路的功能正确性**；但它证明"测试契约与实现已漂移"。三级权限改造若让趋势页支持家属态（A3），契约必须先定（建议以 bpBg 新模型为准更新一致性测试，列入 B4/待确认项 11）。

### 3.3 regression 崩溃后被跳过的用例清单

- 崩溃根因：scripts/health-api-regression.js L295 读取 `list.todayLogs[0]`，真实 getMedListData 已改为返回 `todayCards`（脚本自身 mock 期望 L231-L234 也是 todayCards——断言与 mock 自相矛盾，属复制漂移）。
- main 执行顺序（L521-L527）：testPerfSchema → testMedicationService（**L523 崩溃**）→ testFamilyService → testSettingsDataService。
- 确定未执行：
  - `testFamilyService`（L318-L430）：创建邀请→查询邀请→加入家庭→homeFamily 受控读（含 scope 过滤）整条家庭 happy path；
  - `testSettingsDataService`（L432-L519）：提醒设置、隐私、反馈、数据管理、导出、删除、清空账号（含家庭集合双向清理）。
- 即云端家庭权限链路在当前自动化形态下**零执行**（Jest 又不覆盖 cloudfunctions），A 阶段任何云端改动目前都没有自动化回归护栏——这是 B1-B3 必须先行的依据。

### 3.4 测试真实性结论

- Jest 16 套件：全部 require 真实 services/utils 实现，**无复制逻辑**；但覆盖面不含 cloudfunctions，且默认命令不启用覆盖率阈值。
- 回归脚本：require **真实云端 service 模块**（L2-L5）+ 内存 mock db，主链路测真实实现；但默认值/校验器/normalizer 复制两份（L172-L203、L212-L232、约 L387-L406），mock 能力不足（仅 eq/in、remove 不按条件），且当前提前崩溃。
- 云端 family-service / index 权限函数：**无任何 Jest 覆盖**。

---

## 4. 仍需运行验证 / 人工确认的事项（不写成已验证结论）

1. 微信云调用对 event.userInfo.openId 的注入可靠性、有无非小程序端调用面（待运行验证，关联 P0-1）。
2. 云函数内以家属身份写入时 `_openid` 的归属规则（A4 代录数据建模前置技术验证）。
3. mergeHomeFamilyMedicationStatus 串扰、allowStale 撤销残留时序（待构造场景运行验证）。
4. 线上集合安全规则、inviteCode 唯一索引、家庭数据存量（待人工在云控制台确认）。
5. 豆包工作界面所选模型（待人工留图确认，不以自报身份为证）。
6. service-regression-test.txt 用途、tabBar 图标资源（低优先级，实施时核对）。

---

## 5. 复核结论

旧报告 335 行中的绝大多数事实性论断在当前 HEAD 上**仍成立**，调用链与风险判断可作为本期实施的基础；需要修正的实质性内容共 4 处：
1. 邀请码长度（8 位 → KXJ 前缀共 12 字符）及 Schema 行号（L433→L251）；
2. familyJoin"无需登录态"→"已登录但不校验邀请关系"；
3. 家属二级页现象定性：漏权/混淆，而非越权读取 owner；
4. 反复邀请的影响范围：只重置 family_auth 邀请文档，不直接重置 family_members 关系行。

其余为行号漂移与本轮补充证据。旧报告未覆盖的 14 项新发现见第 2 节，已全部转入 `seed-audit.md` 与 `file-impact-list.md` 的 A/B/C 计划。基线三项失败与 08-11 完全同构，是仓库既有状态，本期只读审计未改变业务代码（Git 工作区仅有 docs 旧报告与 evidence/ 两个未跟踪项，与审计开始时一致）。
