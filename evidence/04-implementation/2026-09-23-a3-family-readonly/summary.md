# A3 二级页面家属只读权限闭环 · 摘要

- 日期：2026-09-23（00:20–01:10，UTC+8）
- 仓库/分支/HEAD：`xiaochengxu` / `feat/family-permission` / `a751776`
- 环境：Node v22.23.2 / npm 10.9.8（豆包会话运行时）；本批在 Zcode 执行。
- 范围：仅家属只读闭环；不进入 A4 代录、A5 缓存、A6 电话、A7 Tab 开放；不部署、不提交。

## 1. 只读审查结论（实施前）

| 审查项 | 结论 |
|---|---|
| 家属身份如何识别 | 服务端 `event.userInfo.openId`（平台注入）→ `getFamilyAccessContext(openId)` 查 family_members active 行（memberOpenId=调用者）；A3 前二级页路由只认调用者自身 openId，**没有家属身份通道** |
| owner 数据主体如何确定 | A3 前 = 调用者自身；A3 后家属视图由服务端从 active 绑定推导 `ownerOpenId`，**客户端传入的 ownerOpenId 等参数一律忽略**（测试固化） |
| 每页对应 scope.read | trend(bpBg 标签)=bloodPressure.read && bloodGlucose.read；trend(medication 标签)=medicine.read；recordList=按类型 bp/bg 各自 read；recordDetail=记录类型对应 read；medList/medHistory=medicine.read |
| 当前是否只隐藏页面 | A3 前**服务端无家属通道也无过滤**（家属根本拿不到 owner 数据，"隐藏"只是入口缺失）；A3 建立服务端闸口：read=false 时响应不含对应数据（`familyView.allowed=false + reason`），recordList 另按 allowedTypes 在查询层过滤 |
| 编辑/删除/计划管理入口 | med-list：编辑计划、长按停用/删除、确认、撤销、添加用药；record-detail：删除记录；home-family：用药日志"确认"跳 medConfirm（写页）。A3 全部在 familyView 下隐藏（wxml）+ js 守卫双重拦截 |

## 2. 实现（20 文件，fix.patch）

**服务端**：
- `family-service.js` 新增 `resolveFamilyView / familyViewDenied / decorateFamilyView / getFamilyTrendData / getFamilyRecordListData / getFamilyRecordDetailData / getFamilyMedListData / getFamilyMedHistoryData`；身份三态 self/member/denied(noBinding|revoked)，owner 带 familyView 按 self 处理；
- `record-service.js getRecordListData(openId, payload, options)` 新增 `allowedTypes` 查询层过滤（`_.in`）；
- `index.js` 五个路由（trend/recordList/recordDetail/medList/medHistory）在 `payload.familyView===true` 时走家属闸口分支。

**客户端**：
- 服务层 familyView 传参：records(report list/detail)、report.getTrendData（familyView 下不混入本人本地记录、跳过 home 调用）、medication-confirm/merge；
- `page-factory.goRoute(routeKey, query)` 支持 query；tabBar 页（trend）经 `app.globalData.familyView` 标记传递；
- 五页（trend/record-list/record-detail/med-list/med-history）`isFamilyView` 只读态 + `familyDenied` 拒绝面板 + 写入口 wxml 隐藏；med-list 八个写 handler 与 record-detail 删除 js 守卫；
- home-family：快捷入口/指标卡带 `familyView=1`，trend 走全局标记，用药"确认"入口改只读提示（代录属 A4，不开放）。

**命名冲突处理**：服务端响应字段 `familyView`（对象）与页面布尔标志同名会被 loadPageData 的 Object.assign 覆盖——页面标志改名 `isFamilyView`（测试同步）。

## 3. 测试（先失败后实现）

`tests/unit/a3-family-readonly.test.js` 14 用例：实现前 **13 失败/1 通过**（before.txt），实现后 **14/14**（after.txt）。覆盖：read=true 返回 owner 数据、read=false 服务端剔除/拒绝、参数切换 owner 被忽略、无绑定/已撤销明确空态（noBinding/revoked）、空数据与拒绝形态可区分（allowed=true+空列表 vs allowed=false+reason）、allowedTypes 查询层过滤、med-list/record-detail 写入口守卫与非 familyView 可用性。

| 检查 | 退出码 | 结果 |
|---|---|---|
| 目标测试 | 0 | 14/14 |
| 全量 Jest | 1 | **552 通过 / 2 失败**（settings.test.js 时区对，见下） |
| regression | 0 | ok（B1 四组真实执行） |
| lint | 1 | 43（11e/32w），与 A2 后基线**逐行一致，零新增**（中途一度 +1 为 report.js 未用参数，已接上消除） |

**settings.test.js 2 失败为既有时区台账**：执行时刻北京 00:55（00:00–08:00 窗口），夹具 UTC 日期与服务端北京日界错配；与 A3 无关，不修、不等时段（台账保留）。

## 4. 本地与云端验证边界

- 本地已证明：闸口判定、allowedTypes 过滤、拒绝形态、参数忽略、页面守卫（Jest + Mock）。
- 云端待验证：部署后 familyView 路由真实响应（含 family_members 有 active 绑定后的端到端）；P0-1 openId 注入；trend 家属视图用药趋势的分母（owner 计划）当前跳过 home 调用、合规率图仅基于 owner 确认记录——**已知限制**，完整分母待 home 路由 familyView 分支（可入 A4/A5 批次）。
- 本批未部署：云端仍为 18:47 版（A2）；A3 服务端代码需下次部署生效（部署前按 rollback-steps 发新快照）。

## 5. 未执行项

A4 代录、A5 缓存治理、A6 电话提醒、A7 Tab 开放/回滚开关、Node18、云端部署与索引/控制台操作、S01/S06 截图、第三账号——均未进行。
