# A5–A7 整合部署前只读核验报告 — 2026-09-23 09:48 (+0800)

性质：**只读核验**。本轮未修复、未部署、未上传体验版、未操作真机、未改云端数据或配置、未提交、未切分支、未清理任何用户改动。输出中不含密钥、完整手机号、完整 openId、邀请码或健康数据。

## 1. 报告与当前代码一致性核对

逐项核对 A5–A7 合并报告、三份子批 summary、A4 部署准备记录与当前工作区代码：

| 报告声明 | 当前代码核验 | 结论 |
|---|---|---|
| A5：家族敏感读零缓存/不回填、loadKey 单调序号、七键精准失效 | core.js familySensitive 6 处命中；page-factory `pageLoadSeq`；family.js `invalidateFamilyCaches` 8 处命中 | 一致 |
| A6：电话规则单点、2 条 action、页面三处入口、条款 3 处 | policy 三函数；index.js actionMap L974-975；home-family/family-auth/family-invite 处理器在位；static-pages 3 处条款 | 一致 |
| A7：开关模块、家庭页运行时判定、死页删除、appConfig 路由 | feature-flags.js 在位；family 页 `familyTabEnabled` js×3/wxml×3；pages/family-sub/index.* 不存在且 app.json family-sub 无 "index"；keyMap 'appConfig' 在位 | 一致 |
| 全量 631/633（夜批窗口内）、regression ok、lint 43 | 本轮实测见 §5 | 一致（时区窗口内外差异见 §5 说明） |
| sendDueReminders 零改动 | `git status cloudfunctions/sendDueReminders/` = 0 条 | 一致 |

**勘误（2 处，本轮未修改文件，仅记录）**：合并报告 §2 与 A6 summary"测试装配"行写作"**六个**测试文件"，实际补装配的是 **7 个**（a0-contract-integration、a1-member-isolation、a2-followup、a2-invite-security、a3-family-readonly、a4-family-write、a5-cache-revocation；grep 复核 8 处命中含 a6 自身）。其余数字、文件清单、补丁校验记录与现状一致。

## 2. Git 状态（快照存 git-status.txt / tracked-changed-files.txt）

- 分支：`feat/family-permission`；HEAD：`a751776be194bb0a9d11cf42c27f093ab5109aca`（未提交任何批次改动，与历批报告一致）。
- 暂存区：**空**（staged 0 files）。
- 跟踪文件改动：53 文件（M=45、D=8），+2426/−1453；D 8 = components/coming-soon×4 + pages/family-sub/index×4（A7 局部改动+死页删除）。
- 未跟踪（非 evidence）18 项：**部署必需 4 项**——cloudfunctions/healthApi/{family-policy,payload-helpers,payload-validation}.js、utils/feature-flags.js；不部署 14 项——tests/unit 12 个测试文件、docs 分析文档 1 个（tests/docs 均在 packOptions ignore，云函数部署单位不含 tests）。
- 所有用户既有改动保持原样，未清理。

## 3. 完整 diff 审查与部署范围

**云函数部署范围**（部署单位 = `cloudfunctions/healthApi/` 目录，按文件系统打包）：
- 磁盘 14 项：index.js、family-service.js、family-policy.js*、payload-helpers.js*、payload-validation.js*、medication-service.js、record-service.js、daily-stats-service.js、settings-data-service.js、report-service.js、static-pages.js、perf.js、package.json、node_modules/（* = 未跟踪但必需；A3 已部署版含前三者，本轮无部署动作）。
- 一次部署同时生效：A3 装配缺陷修复 + A4 四写路由 + A6 电话（2 action + homeFamily/familyAuth 字段 + 条款）+ A7 appConfig 只读路由。sendDueReminders 云函数**不部署**（零改动）。
- **部署方式约束**：若改用基于 git 的 CI 部署，3 个未跟踪共享模块会缺失导致运行时崩溃；当前 tcb/IDE 通道按磁盘上传无此问题。

**小程序体验版上传范围**（整包，packOptions ignore 生效：cloudfunctions、tests、evidence、docs、scripts、node_modules、.codex、package-lock.json 等 27 项均排除）：
- 含 A3 验收修复（趋势重复入口、trend onShow）、A4 页面（home-family/record-bp/record-bg/med-list）、A5（services/core、page-factory、services/family）、A6 页面（home-family/family-auth/family-invite + wxss）、A7（feature-flags、pages/family、app.json 死页注销）。
- **会包含 A7 家庭 Tab 开放代码**：体验版 envVersion=trial → 开关默认**开**（与用户先前"体验版包含 A7 开放代码"的确认一致）；正式版 release 默认**关**。远程配置可双向覆盖（app_configs 未建时回退默认）。

## 4. A3 已知装配缺陷复核

- **已确认修复（工作区代码级）**：`getFamilyService()` 注入与 `createFamilyService({...})` 工厂参数**全量比对 27/27 一致，MISSING=[]、EXTRA=[]**（脚本化比对，非抽查）；关键注入 getRecordService/getMedicationService/getDailyStatsService/canPerformScopeAction + A6 三电话函数全部在位。
- **A4–A7 对该修复的依赖**：A4 家属写路由（getMedicationService/getDailyStatsService/canPerformScopeAction）、A3/A5 家属视图数据路由（getRecordService/getMedicationService）、A6 homeFamily 电话字段（canCallReminderPhone/maskContactPhone）均依赖装配完整；A7 appConfig 路由独立无依赖。
- 云端现行为 A3 部署版（含该缺陷）——**部署 A4–A7 即同时修复**；在部署前，线上家属视图数据路由的 TypeError 依旧存在（记录于 A4 data-flow-review §5）。无阻塞项。

## 5. 只读检查与测试实测（真实退出码）

| 检查 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 目标测试（A5×2+A6+A7+A3+A4 六套件） | npx jest …6 files | **93/93 通过** | **0** |
| 全量 Jest | npx jest | **633/633 通过**（29 套件全绿） | **0** |
| regression | npm run regression | health-api-regression: ok | **0** |
| lint | npm run lint | **43 problems（11 errors/32 warnings）**，与历次基线一致 | **1**（errors>0 时 lint 非零退出，属基线既有状态，非本轮引入；11 个 error 为历史台账项，decisions #16 口径：只建台账不夹带修复） |

**settings 时区失败说明（重要反证）**：夜批三次全量运行（北京时间 00:00–08:00 窗口内）均为 2 失败（595/597、617/619、631/633，失败均为 tests/unit/settings.test.js 时区敏感对）；本轮 09:48（窗口外）**同一代码 633/633 全绿**。两组数据互相印证：失败纯由运行时刻落在断言的时区窗口导致，与 A5–A7 改动无关。**不表述为"始终全绿"**：窗口内运行仍会失败（台账保留）。本轮未为通过而修改任何测试或代码。

原始输出：target-tests.txt / full-test.txt / regression.txt / lint.txt（本目录）。

## 6. 跨批次静态检查与待实证清单

**静态检查通过项（代码级证据）**：
- A5：家族页面/家属态二级页**零本地存储写入**（grep setStorageSync/writeStorage = 0 命中）→ owner 数据不落 B 端存储；家族敏感读旁路缓存与拒绝不回填在 core.js 单点实现；action 成功全局清缓存保留。
- A6：完整号码在服务端**仅一个返回点**（familyGetReminderPhone L1411，前置 resolveMemberWriter active 关系 + canCallReminderPhone + 号码存在三道闸）；homeFamily/familyAuth 家属侧只出脱敏号；错误文案固定不回显号码；console 输出号码 = 0 命中；无 wx.getPhoneNumber（全仓 0 命中）。
- A7：开关关闭时 onShow 提前返回（L98）、onLoad 不加载数据；开关判定为纯函数+远程布尔严格校验；feature-flags 仅家庭页引用（文件系统扫描测试固化）；**页面隐藏 ≠ 服务端鉴权**——家庭页占位仅不加载 owner 侧家庭数据，家属数据授权仍由服务端 family-policy 闸口独立判定（A3–A6 路由未因开关改变）。

**尚需真机 / 接口响应 / 云端数据证明的行为（静态检查不可替代）**：
1. A4 代录/代确认/撤销的真机归属落库（`_openid`/审计字段 db 取证）；
2. A5 端到端：A 撤销/改权后 B 真机下一次请求即拒、停留页不回填、旧请求不覆盖；
3. A6：setFamilyContactPhone/familyGetReminderPhone 部署后真实响应；B 端 wx.makePhoneCall 真机拨号（系统拨号盘显示完整号属平台行为）；关 remind/清号/撤销后取号即拒的真机时序；
4. A7：appConfig 路由真实响应（含 app_configs 缺失时回退 null）；远程改配置→端侧 onShow 生效；release 环境默认关的实际表现；
5. A3 装配修复的线上生效判别（familyView 探测 denied noBinding）；
6. `tcb fn log` 取样 event.userInfo.openId 稳定性（日志级复核，A4 遗留待办）。

## 7. 部署前置条件清单

| 前置项 | 状态 | 说明 |
|---|---|---|
| 唯一云环境是否承载正式小程序 | **未确认** | 仅知一个环境 kangxiaoji-d5gw2k203f0488a9e（项目 appid wxcb…fb）；该环境是否被线上正式版使用需公众平台/控制台人工确认。本轮 CLI 云查询通道不可用（`cli cloud functions info` 空报错，与此前上传通道故障一致），无法远程佐证。**部署授权前必须关闭此项** |
| 部署授权 | **未确认（阻塞）** | 用户尚未对 A4–A7 部署给出授权；本轮明确不部署 |
| 回滚快照 | **未确认（待办）** | `backup-a4-predeploy-<部署日>` 未发布；v1/v2/v3 存在仅依据 09-23 01:21 部署记录，本轮无法云端复核 |
| 云函数版本现状 | **未确认** | 最后权威记录：A3 版 09-23 01:22:30 部署、冒烟 5 项过；本轮 CLI 不可用未复核 |
| 体验版上传内容 | **已确认（代码面）** | 见 §3；上传动作本身未执行（人工步骤，IDE 上传→公众平台设体验版） |
| 测试账号 A/B | **已确认（记录在案）** | A=owner、B=家属，A3 验收期 active 绑定（掩码记录在 A4 identity-ownership-check.md）；部署后真机验证前需复核绑定仍 active |
| 测试数据清理方案 | **已确认** | A4 dual-phone-plan 步骤 10（按 _id 精确删 records/confirmations，source='family' 甄别）+ A6 summary 口径；family_invite_attempts 遗留 4 条走 TTL；A6 拨号验证须用脱敏测试号码 |
| 人工截图清单 | **已确认（清单备齐，未拍摄）** | A4-F01..F05（dual-phone-plan）、A6-P01..P08（screenshot-list.md）、A7-T01..T05（合并报告 §5 建议）；历史缺口 S01/S06 维持原记录 |

## 8. 建议执行顺序与风险（本轮不执行）

**顺序**：
0. 关闭两项未确认：控制台/公众平台确认环境承载关系与线上版本；取得部署授权。
1. 以可用通道（tcb 登录或控制台）复核云端：$LATEST=A3 版、v1/v2/v3 在列。
2. 发布回滚快照 `backup-a4-predeploy-<部署日>`。
3. 部署 healthApi（按磁盘目录，含 3 个未跟踪共享模块与 node_modules）→ 冒烟：familyView 探测（无绑定→denied noBinding）、appConfig（→familyTabEnabled:null）、setFamilyContactPhone 非法号拒绝（零写入，不落真实号码）。
4. IDE 手动上传体验版 → 公众平台设体验版 → 确认体验版家庭 Tab 开（trial 默认）。
5. 双手机按序：A4 十步计划 → A5 撤销/改权端到端 → A6 拨号链路（脱敏测试号）→ 截图归档（与 db 掩码记录/接口响应配对，截图不单独证明归属）。
6. 清理测试数据（按 _id 精确；保留策略记录）。
7. 正式发布决策（未进入）：创建 app_configs + familyTabEnabled=true 或修改 release 默认值，二者均需重走验收。

**风险**：
- 部署即改变线上行为：修复 A3 家属视图 TypeError 的同时上线 A4 写路由与 A6 电话路由——全部有服务端闸口与本地测试覆盖，但**云端真实行为未验证**；回滚路径=快照 config-route。
- 若该环境承载正式流量：部署窗口存在冷启动/短暂错误风险；建议低峰执行并预先确认回滚执行人。
- git-based 部署方式会漏未跟踪模块（见 §3 约束）——部署方式必须为磁盘上传。
- app_configs 未创建期间远程开关不可用（端侧默认兜底，无故障面）；体验版家庭 Tab 默认开，如有外部体验用户需知晓 A4–A6 功能对体验版可见。
- settings 时区对在窗口内运行仍失败（非部署阻塞，台账）；lint 11 errors 为历史基线（非本程序引入，decisions #16 台账口径）。
- 本轮全部结论为**本地/静态证据**：代码测试通过 ≠ 云端或真机验收通过；页面隐藏 ≠ 服务端鉴权。

## 附：本轮执行的只读命令清单

git branch/rev-parse/status/diff（只读）；grep/sed/node 静态扫描（只读）；npx jest（本地测试，无网络写入）；npm run regression（本地脚本，存储替身）；npm run lint；`cli cloud functions info`（云端只读查询，通道失败无副作用）。未执行任何 deploy/publish/config-route/db 写/真机/截图操作。
