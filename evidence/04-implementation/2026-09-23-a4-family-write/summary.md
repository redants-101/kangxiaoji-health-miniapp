# A4 批次总结（家属代录写入闭环）— 2026-09-23

分支 `feat/family-permission`（HEAD `a751776`）。本批**未提交、未切分支、未部署**；全部改动在工作区。部署为下一步动作，须用户授权（见 §6）。

## 0. 交付清单（本目录）

| 文件 | 内容 |
|---|---|
| identity-ownership-check.md | A4-0 身份/归属最小实验（探针已删，未写真实健康数据，无完整 openId/手机号/邀请码落盘） |
| data-flow-review.md | 写路由、读归属、页面入口、禁止项落实、A3 装配缺陷发现 |
| before.txt | A4 测试首跑（实现前）：18 failed / 1 passed |
| before-record-bg-fix.txt | record-bg 补漏用例实现前：19 passed / 1 failed |
| after.txt | A4 目标测试（实现后）：20/20 |
| full-test.txt | 全量 Jest：573/575（仅 settings 时区对失败，见 §1.8） |
| regression.txt | `npm run regression`：ok |
| lint.txt | `npm run lint`：43 problems（11 errors/32 warnings），与历史基线一致 |
| fix.patch | A4 独立补丁（16 文件），校验见 patch-verification.md |
| patch-verification.md | 补丁基线树构建、APPLIED-CLEAN、16/16 逐字节 MATCH |
| dual-phone-plan.md | 双手机联调计划（部署授权后执行） |

## 1. 本地已验证

1. **A4-0 实验**（identity-ownership-check.md）：服务端显式写 `_openid` 原样保留；缺省时平台写 null（不自动注入、不覆盖显式值）→ 归属方案采用：服务端从 active family_members 派生 ownerOpenId，写 `_openid=ownerOpenId` + `ownerOpenId` + `createdByMemberOpenId` + `createdByRole='member'` + `source='family'`；owner 既有按 `_openid` 的查询零改造即可见代录记录。未触发"无法确认即停止"条款。
2. **测试先行**：实现前失败输出保留（before.txt 18F/1P）；实现后 A4 20/20；A3+A4 联跑通过；未删测试、未跳过断言、未放宽预期。
3. **权限矩阵**：代录血压/血糖、代确认、撤销代确认均要求 scope read+write（canPerformScopeAction）；只读、只写（无读）、remind-only 一律 `scopeDenied`；remind 不参与写判断。
4. **身份/关系/审计**：客户端伪造 `ownerOpenId/createdByMemberOpenId/_openid/memberId` 一律忽略（不入参）；revoked/noBinding 拒绝；owner 走家属写路由拒绝（notMember）；先鉴权→再校验→后写库，失败零写入；审计字段齐备。
5. **代确认与撤销**：taken/skipped 按 (owner, logId, 当日) upsert 幂等、无不可解释重复文档；他人（owner 或其他成员）创建的确认 → `foreignRecord` 拒绝；撤销仅限本人本次代确认，重复撤销 `notFound`。
6. **禁止项**：不存在家属计划增删改、健康记录删除、越权撤销路由（typeof undefined 测试固化）；页面不渲染对应入口且有 JS 守卫。
7. **页面**：home-family 代录入口按 `writePermissions` 渲染（无权即隐藏）；record-bp/record-bg 家属态提交走家属路由，云端拒绝时显式提示 + `submitError`，不本地假成功、不导航；med-list 家属态已服/跳过按钮受 `familyCanConfirm` 控制，撤销按钮仅 `canRevokeProxy` 项可见；云端响应为唯一事实源。
8. **全量检查**：Jest 573/575——仅 2 失败为 `tests/unit/settings.test.js` 时区敏感对（本次运行处于北京时间 00:00–08:00 失败窗口；按指示**单独记录，未修改任何 A4 代码掩盖**）；`npm run regression` ok；lint 43 problems（11e/32w）与历次基线完全一致，record-bg 修改无新增问题。**cloudfunctions/ 不在现有 lint 范围内**（eslint 仅覆盖小程序端代码），明确写出。
9. **批内真实纠错**（对应证据矩阵 E21）：收尾自查发现 **record-bg 页面遗漏家属态分支**——home-family 已有"代录血糖"入口，若 B 直接提交将走本人路由、静默误写到 B 自己名下。按测试先行补用例（实现前失败：before-record-bg-fix.txt），随后补齐页面分支（与 record-bp 同构），A4 20/20、全量/regression/lint 复跑通过，fix.patch 由 15 文件重生成为 16 文件并重新校验。

## 2. 已部署但未真实验证

- 云端现行为 **A3 版**（2026-09-23 01:22:30 部署，当时冒烟 5 项通过）。该版存在**装配缺陷**：family-service 缺 `getRecordService/getMedicationService` 注入 → 家属视图数据路由（trend/recordList/medList/medHistory 带 familyView）真机会抛 TypeError，即验收"问题 2"（家属看不到老人趋势）的服务端半边根因。修复已在本批 index.js 装配补齐，但**未部署**，修复效果未经真实验证。
- A3 客户端验收修复（趋势重复入口删除、trend onShow 重估 familyView）已完成于工作区，**体验版未重新上传**（上传为人工步骤，证据中无再上传记录）→ 现网体验版仍是旧行为。
- A4 全部服务端改动未部署：云端当前**没有** familyRecordBloodPressure / familyRecordBloodGlucose / familyConfirmMedication / familyRevokeProxyConfirmation 四条路由，调用将按未知路由报错。

## 3. 云端真实验证

（历史累计 + 本批实验，均有当期证据）

- A2 邀请/加入/撤销全链路真机验证（历史批次）。
- A3 部署冒烟：familyView 探针对无绑定账号返回 `denied noBinding`（01:22）。
- 验收期行为级：B 真机 join 后 family_members 存在 active 行（owner≠member，掩码 ovjd…AU / ovjd…9E）；B 可进入家属视角页面。
- 本批 A4-0 探针：显式 `_openid` 保留 / 缺省为 null；探针文档（content=A4-PROBE-DELETE-ME）已精确删除 n=2；实验未写入真实健康数据。

## 4. 尚未验证

- A4 全部写路径真机验证：代录血压/血糖归属落库（db 掩码取证）、代确认幂等、撤销边界、撤销授权后写拒绝 → 部署授权后按 dual-phone-plan.md 步骤 1–10 执行。
- 截图 A4-F01..F05：仅在部署 + 真实账号验证后拍摄；截图不单独证明归属，须与 db 记录/API 响应配对归档。
- 日志级身份复核：本轮 `tcb fn log` 窗口为空，`event.userInfo.openId` 样本待下次真实调用后立即取样。
- A3 装配缺陷修复的线上生效（随 A4 部署后冒烟判别）。
- settings 时区对（已知限制，台账在案）；S01/S06 截图缺口（历史台账）；family_invite_attempts 遗留 4 条文档（TTL 24h 自动清理，无需干预）。

## 5. A5/A6/A7 未进入

本批止于 A4，未触碰 A5/A6/A7 任何代码。现体验版包含的家庭 Tab 开放代码属 A7 预置展示层（用户先前确认保留），其完整实现与验证不在本批范围。

## 6. 部署前报告（不自动部署；以下动作须授权后执行）

1. **身份实验结果**：见 §1.1 / identity-ownership-check.md；归属机制不依赖未确认项。
2. **A4 healthApi 修改文件**（部署单位=整个 healthApi 云函数）：
   - `cloudfunctions/healthApi/family-service.js`：4 个家属写方法 + resolveMemberWriter + homeFamily `writePermissions` 下发 + medList `familyView.writePermissions`/`canRevokeProxy`；
   - `cloudfunctions/healthApi/index.js`：actionMap 新增 4 条家属写路由；装配补齐 `canPerformScopeAction/getRecordService/getMedicationService/getDailyStatsService`（同时修复 A3 缺陷）；
   - `cloudfunctions/healthApi/medication-service.js`：`confirmMedication` 支持 `options.audit` 审计注入。
3. **前端待上传页面**（整包上传；A4 涉及文件）：pages/family-sub/home-family/index.{js,wxml}、pages/record/record-bp/index.js、pages/record/record-bg/index.js、pages/medication/med-list/index.{js,wxml}、pages/trend/index.js（A3 验收修复）、services/family.js、utils/api.js。上传方式：微信开发者工具手动上传 → 公众平台设为体验版（CLI 上传通道此前不可用）。
4. **回滚快照**：部署前执行 `tcb fn publish-version healthApi "backup-a4-predeploy-<部署日>"`（固化当前线上 A3 版）。现有快照：v1 backup-before-a0a1a2-deploy、v2 backup-a2-deployed-20260922、v3 backup-a3-predeploy-20260923（代码=A2 版）。
5. **测试账号**：A=owner（老人手机）、B=家属（女儿手机），验收期已绑定 active 关系（若已撤销需重新邀请）；openId 仅以掩码记录（ovjd…AU / ovjd…9E）。
6. **测试数据清理范围**：联调产生的 records（`source='family'` 且 `createdByMemberOpenId=B`，按 _id 精确删除）与对应 medicationConfirmations 代确认文档；A4-0 探针已清理；family_invite_attempts 遗留 4 条交 TTL；不触碰 A/B 任何非测试数据。
7. **云端待确认项**：§4 全部条目；部署后先跑 dual-phone-plan 冒烟判别（familyView 探测），再进入真机步骤 1–10。
