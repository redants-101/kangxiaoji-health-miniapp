# A5→A6→A7 夜间开发批次合并报告 — 2026-09-23

分支 `feat/family-permission`（HEAD `a751776`）。本夜批**未提交、未切分支、未部署、未上传体验版、未操作真实手机、未修改云端数据、未创建云端资源**。三个子批次各自独立执行"失败测试先行 → 实现 → 目标测试 → 证据"，无跨批合并的模糊数字。

## 0. 子批次结果一览（数字不合并）

| 批次 | 实现前失败输出 | 目标测试 | 全量 Jest（当时） | regression | lint | fix.patch 校验 |
|---|---|---|---|---|---|---|
| A5 撤销实时生效与缓存治理 | 9 failed / 13 passed | 22/22 | 595/597 | ok | 43（11e/32w）=基线 | APPLIED-CLEAN，5/5 MATCH |
| A6 电话提醒 | 20 failed / 2 passed | 22/22 | 617/619 | ok | 43=基线 | APPLIED-CLEAN，24/24 MATCH |
| A7 家庭 Tab 开放/死页/回滚开关 | 套件无法运行（feature-flags 模块缺失） | 14/14 | 631/633 | ok | 43=基线 | APPLIED-CLEAN，8/8 MATCH + 4/4 删除确认 |

- 最终全量：**631/633**——仅 2 失败为 `tests/unit/settings.test.js` **时区敏感对**（运行时段处北京时间 00:00–08:00 失败窗口；按指示单独记录，未修改任何夜批代码掩盖；台账延续）。
- A0–A6 九套件联跑 173/173（含 A3/A4 相关测试）；A7 14/14。
- lint 43 problems（11 errors/32 warnings）三批次均与历次基线一致，无新增。**cloudfunctions/ 不在现有 lint 范围**（A6 改 4 个云端文件、A7 改 1 个，明确写出）。
- 补丁基线链：pre-a5（夜批开始时工作区快照=A4 完成态）→ +A5 补丁=pre-a6 → +A6 补丁=pre-a7；三个 fix.patch 均在对应基线的独立副本上验证应用并逐字节比对工作区。

## 1. 本地已验证

- A5：家族敏感读零缓存每次回源；失败不旧数据回填（带 errCode 拒绝对任何键不回填）；owner 读 60s TTL+网络失败回退保持；action 成功全局清缓存保持；家族事件（撤销/改权/加入/邀请/代录成功）精准失效七页面键并置脏；镜像按 memberId 精确增删（撤 M1 保留 M2）；同毫秒双加载旧请求晚归不覆盖新状态（loadKey 单调序号）；镜像只收窄不放行；注销清本人存储与缓存；服务端撤销后 M1 全拒/M2 不受影响/owner 自读不受影响；改权后下一次读取立即按新 scopes 过滤。
- A6：电话规则单点（normalize/mask/canCall 在 family-policy）；owner 设置/修改/清空（先校验后写、失败零写入、响应不回显完整号）；remind=true 家属仅脱敏号；remind=false 脱敏号也不回传；read=false+remind=true 仅电话入口（readPermissions 门控 + 二级页 scopeDenied）；拨号按需取号（action 不入缓存、号码不落 data/storage）；撤销/清号/关 remind 后取号即拒（revoked/notConfigured/remindDenied/noBinding/notMember）；member 不能污染所拨号码；makePhoneCall 失败显式提示不假设已拨出；错误文案与日志不含完整号码；sendDueReminders 零改动（契约扫描测试）；不实现 wx.getPhoneNumber、不新增订阅消息。
- A7：开关默认值（release 关/trial 开/develop 开）与远程布尔覆盖两方向、异常保守回退；家庭页开→真实页+加载、关→占位+不加载；加载失败/重载；空成员与 pending/active/revoked 三态数据；邀请/管理/撤销入口（含预览卡守卫）；死页四文件删除+app.json 注销+全仓无引用+五路由完整；owner/member 页面不混淆；feature-flags 引用范围仅家庭页。

## 2. 代码已完成但未部署

云端 healthApi（工作区态，云端仍为 09-23 01:22 的 A3 版）：
- A4：家属写四路由 + 装配缺陷修复（A3 版家属视图数据路由真机 TypeError 的服务端半边）；
- A6：family-policy 电话规则、setFamilyContactPhone/familyGetReminderPhone、homeFamily +phoneReminder/readPermissions、familyAuth +contactPhone、createFamilyInvite 携带号码、getFamilyData 纯电话文档守卫、static-pages 电话条款×3；
- A7：COLLECTIONS.appConfigs + getAppConfigData + keyMap 'appConfig'。

前端（体验版未重新上传，现网体验版=A3 验收前旧包）：
- A3 验收修复（趋势重复入口、trend onShow 重估）；A4 页面（home-family 代录入口、record-bp/record-bg 家属态、med-list 代确认/撤销）；A5（services/core 缓存策略、page-factory 序号、services/family 精准失效）；A6 页面（home-family 电话入口+readPermissions 门控、family-auth 电话编辑、family-invite 电话+勾选）；A7（feature-flags、家庭页开关+占位态、app.json、死页删除、utils/api getAppConfig）。

## 3. 云端待验证（部署后）

1. A4 全部写路径真机归属（dual-phone-plan A4 步骤 1–10）；A3 装配缺陷修复生效判别（familyView 探测）；
2. A5 端到端：A 撤销 → B 真机下一次请求即拒（页面不回填旧数据）；改权后 B 刷新即过滤；
3. A6：setFamilyContactPhone/familyGetReminderPhone 真实响应；B 端拨号全链路；撤销/关 remind 后取号拒绝；
4. A7：appConfig 路由真实响应（含 app_configs 集合缺失时回退 null 的容错）；远程改配置 → 端侧 onShow 生效。

## 4. 需要双手机验证（A=owner，B=家属）

- A4 双手机计划全部步骤（代录归属、代确认幂等、撤销边界、撤销授权后写拒绝）；
- A5：A 撤销/改权瞬间 B 停留页与重开页行为（不回填、不覆盖）；
- A6：A 配置/清空电话、关 remind → B 端入口与取号状态变化（A6-P03..P08 场景）。

## 5. 需要人工截图（本轮未拍，清单已备）

- A4-F01..F05（A4 批 dual-phone-plan）；A6-P01..P08（A6 批 screenshot-list.md）；
- A7：正式版默认占位态（release 模拟或远程关）、体验版真实家庭页、空成员态、三态成员列表、加载失败态（建议编号 A7-T01..T05）；
- 历史缺口保持原记录：A2 的 S01（未提供）、S06（待第三账号）。

## 6. 需要 CloudBase 控制台操作

1. （既有待办）A4 部署前发布回滚快照 `backup-a4-predeploy-<部署日>`；部署 healthApi（一次部署同时生效 A4+A5 无云端改动+A6+A7 云端部分）；
2. （A7 可选）启用远程开关：创建集合 `app_configs` + 文档 `{_id:'app_config', familyTabEnabled:boolean}` + 安全规则仅云函数读写；**未创建时无故障面**（端侧默认生效）；
3. （无新增）A6 contactPhone 复用 family_auth，无新集合/索引需求；
4. 既有台账：family_invite_attempts 遗留 4 条文档待 TTL 清理；Node18 运行时切换（decisions #13，独立阶段）。

## 7. 当前仍未进入的正式发布步骤

- 正式版发布（release 默认家庭 Tab 关；开放需远程配置 true 或修改默认值并重新验收）；
- 体验版重新上传（含 A3 修复 + A4–A7 页面）——人工步骤；
- 生产真实数据验收、性能/安全复核、发布合规检查清单（docs/微信小程序发布合规检查.md）逐项核对；
- A5–A7 的真机端到端验证与全部截图归档；
- 提交/合并（本夜批与历批次一致：工作区改动，未 commit）。

## 8. 遗留与已知限制（不掩盖）

- settings.test.js 时区对：仅北京时间 00:00–08:00 窗口失败，本夜批三次全量运行均在窗口内，如实记录；
- 历史补丁链重放的顺序性问题（a3-family-readonly 在部分链序下上下文不匹配）已记录于 A4 patch-verification.md 备注；夜批三补丁改用"连续快照基线"（pre-a5→pre-a6→pre-a7），逐批独立验证，不依赖历史链重放；
- 用药趋势分母问题：维持已知限制延期（用户先前确认）；
- home-family 过期文案"代录待开放"已在 A6 修正为"请进入用药列表进行代确认"（行为不变，仍不直开 owner 确认页）。
