# A4 数据流审查（代录写入闭环）

## 1. 写路由（index.js actionMap 新增 4 条，均先鉴权后校验再写库）

| 路由 | 服务方法 | 鉴权 | 校验 | 写入 |
|---|---|---|---|---|
| familyRecordBloodPressure | family-service.familyRecordBloodPressure | resolveMemberWriter（active 关系）+ canPerformScopeAction(recordBloodPressure)=bp read+write | validateBloodPressurePayload（payload-validation 纯模块） | records.add：`_openid=ownerOpenId` + ownerOpenId + createdByMemberOpenId + createdByRole='member' + source='family' + 业务字段 + createdAt；并更新 owner 的 dailyStats |
| familyRecordBloodGlucose | 同上（bg） | 同上（recordBloodGlucose） | validateBloodGlucosePayload | 同上 type='bg' |
| familyConfirmMedication | family-service.familyConfirmMedication | + canPerformScopeAction(confirmMedication)=medicine read+write | validateMedicationConfirmationPayload（经 medication-service） | medicationConfirmations upsert（logId+confirmDate 既有机制）+ 审计字段；他人创建的确认 → foreignRecord 拒绝 |
| familyRevokeProxyConfirmation | family-service.familyRevokeProxyConfirmation | + canPerformScopeAction(revokeMedicationConfirmation) | logId 必填；仅本人本次代确认 | 删除该确认文档；重复撤销 notFound |

客户端参数 `ownerOpenId / createdByMemberOpenId / _openid / memberId` 一律不读取（忽略）。

## 2. 读路径归属

- owner 自有查询（recordList/recordDetail/trend/home）：按 `_openid=openId`；代录记录 `_openid=ownerOpenId` 与其同值 → 零改造可见（探针已证服务端显式写入保留）；审计字段 ownerOpenId 为归属权威；
- 家属视图（A3 闸口）：按绑定推导 ownerOpenId + read 过滤；medList 家属态新增 `familyView.writePermissions.medicine` 与确认项 `canRevokeProxy` 标记；
- homeFamily 响应新增 `writePermissions{bloodPressure,bloodGlucose,medicine,report:false}` 供页面渲染写入口。

## 3. 页面写入口（家属态）

| 页面 | 入口 | 守卫 |
|---|---|---|
| home-family | 家属代录：代录血压/代录血糖（按 writePermissions 渲染） | wx:if + handleProxyRecord 携带 familyView=1 |
| record-bp | 家属态提交走 familyRecordBloodPressure | isFamilyView 分支；拒绝时 submitError+toast，不本地假成功、不导航 |
| record-bg | 家属态提交走 familyRecordBloodGlucose（与 record-bp 同构。注：初版实现遗漏该分支，收尾由新增测试先行捕获后补齐，失败输出见 before-record-bg-fix.txt） | isFamilyView 分支；拒绝时 submitError+toast，不本地假成功、不导航 |
| med-list | 家属代确认 已服/跳过 按钮（familyView && familyCanConfirm）；撤销按钮仅 canRevokeProxy 项 | handleFamilyConfirm/_familyRevokeProxy 以云端响应为准 |
| med-list 计划增删改/编辑 | 不渲染（A3）+ js 守卫 | 保持 |
| record-detail 删除 | 家属态隐藏（A3） | 保持 |

## 4. 明确禁止项落实

- 无家属计划管理/记录删除路由（typeof undefined 测试固化）；
- 撤销仅限本人本次代确认；owner/他人确认拒绝（foreignRecord/notFound）；
- read=false 或 write=false 任一缺失即 scopeDenied；remind 不参与写判断；
- 重复代确认走 upsert（同 logId+当日 单文档），不产生无法解释的重复。

## 5. 发现并修复的部署级缺陷（A3 遗留）

A3 部署版（2026-09-23 01:22:30 部署，见 `../2026-09-23-a3-deploy-preflight/deploy-record-a3.md`）的 family-service 装配缺 `getRecordService/getMedicationService` 注入 → 家属视图数据路由（trend/recordList/medList/medHistory familyView）在真实环境会抛 TypeError——验收"问题 2"的服务端半边根因。本批已在 index.js 装配补齐（含 getDailyStatsService、canPerformScopeAction），**需随 A4 部署生效**。
