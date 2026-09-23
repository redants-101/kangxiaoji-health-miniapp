# 阶段 3 · 页面状态矩阵（page-state-matrix）

- 日期：2026-09-22；需求依据 `evidence/02-repo-analysis/2026-09-22/decisions.md`
- 配套文件：`visual-review.md`（V01-V09 截图观察）、`screenshot-checklist.md`（补图编号 S/U/O/F/G）
- 分类口径（严格区分，不得混用）：
  - **A = 当前真实截图已证明的状态**（仅 S00 一张截图能证明的内容）。
  - **B = 当前代码已有、但尚未运行验证的状态**（含被注释/不可达页面；标注代码位置与可达性，不等于已验证，更不等于已上线）。
  - **C = 依据 decisions.md 需要新增/修改的设计状态**（当前不存在任何实现与截图，禁止以设计稿或描述冒充现状）。
- 安全边界：截图与本矩阵都**不能**证明"接口已停止返回号码/数据"或"后端已拒绝访问"；C 类状态的服务端有效性必须以 Jest/回归/云日志/抓包为最终证据，截图只验 UI。
- 行号基于 HEAD `a751776`。

---

## 0. 页面可达性总表（当前构建）

| 页面 | 路由键 / 注册 | 当前 UI 可达性 | 依据 |
|---|---|---|---|
| 家庭 Tab（owner 主页） | family；app.json L6、tabBar L102-L105 | **可达，仅占位** | family/index.wxml L14-L20 |
| family-invite 邀请页 | routes L33 | **不可达**（入口在注释块内） | family/index.js L73-L75；wxml L21-L78 |
| family-join 加入页 | routes L34 | **半可达**：onboarding 家属路径"去加入家庭"可无码进入；有效码只能靠分享卡片 | family-join-hint/index.wxml L38；family-invite 分享 path L45 |
| family-join-hint 等待邀请 | routes L35 | **可达**（角色选"帮家人管理"） | settings/role/index.js L67-L69；pre-check L242 |
| family-auth 授权管理 | routes L36 | **不可达**（入口在注释块内） | family/index.js L89-L92 |
| home-family 家属首页 | routes L37 | **半可达**：等待邀请页"查看家属首页"可进入无授权空态；有授权态不可达 | family-join-hint/index.js L63-L65；family-service L39-L53 |
| family-sub 中转页 | app.json L52，routes 无键 | **死页**（decisions 已决定删除） | family-sub/index.js L12-L22 |
| trend / recordList / recordDetail / medList / medConfirm | routes 既有键 | 本人角色正常可达；家属态不存在 | home-family/index.js L71-L115 跳转不带 owner |

---

## 1. 家庭 Tab `pages/family/index`

| ID | 状态 | 类 | 触发/条件 | 现状位置 | 决策/计划 | 验收图 |
|---|---|---|---|---|---|---|
| 1.1 | tabBar"家庭"可见、选中态绿色 | A | 进入 Tab | app.json L102-L105；S00 | 保留 | S00/S01 |
| 1.2 | coming-soon 占位（图标/标题/描述/订阅按钮/hint） | A | 页面加载完成 | index.wxml L14-L20；coming-soon 组件 | A7 移除 | S00/S01 |
| 1.3 | 真实家庭 UI 不出现 | A | 始终（当前构建） | wxml L21-L78 注释 | A7 设计恢复并改造 | S00 |
| 1.4 | 加载态"正在加载家庭协同" | B | isLoading | wxml L1-L6 | 保留 | S03 |
| 1.5 | 错误态"家庭数据加载失败/重新加载" | B | loadError | wxml L7-L13 | 保留 | S04 |
| 1.6 | owner 真实 UI：共享状态、成员卡（头像/姓名/关系角色/状态徽章/授权范围/管理权限/解除授权/最近查看）、空成员引导、notice-bar、固定"邀请家属" | B（**被注释，当前构建不可渲染**） | 解除注释后 | wxml L22-L77；index.js L29-L146 | 按三级模型改造后恢复：成员卡授权汇总改三级文案、号码脱敏、增加电话相关元素 | O01/O06/O09 |
| 1.7 | 解除授权确认弹窗"确认解除授权？…不能继续查看你的新记录" | B（不可达） | 成员卡解除 | index.js L98-L124 | 文案补充"代录与电话提醒同步终止"；走 memberId 安全分支（A1） | O08 |
| 1.8 | onShow 自动刷新、分享给朋友/朋友圈 | B（不可见逻辑） | 切回 Tab/菜单 | index.js L50-L56、L127-L146 | 分享路径应改为带邀请码的加入页（现 onShareAppMessage path 只到 /pages/family/index，**现状分享不带码，实施时核对**） | — |
| 1.9 | Tab 放开后的真实页面（含三级权限下的成员管理） | C | A7 | — | decisions 第 1-2 节；file-impact A1/A7 | O01/O06/O09 |
| 1.10 | 回滚开关关闭后恢复占位 | C | 远程开关 | 运行时无 featureFlags（grep 仅 qa 文档） | A7 远程云配置开关 | G04 |
| 1.11 | 占位/成员页文案体现代录与电话提醒、合规边界 | C | A7 | 现描述仅"查看记录和用药状态"（V09） | decisions 第 1 节 | O01 |

## 2. 邀请页 `pages/family-sub/family-invite`

| ID | 状态 | 类 | 触发/条件 | 现状位置 | 决策/计划 | 验收图 |
|---|---|---|---|---|---|---|
| 2.1 | 加载/错误态 | B | 页面生命周期 | wxml L1-L13 | 保留 | — |
| 2.2 | 关系四宫格（女儿/儿子/配偶/其他） | B（不可达） | onLoad 云端返回 | index.js L20-L33；云端 index.js L528-L535 | **C：改为 8 种**（decisions 第 1 节第 6 项） | O02 |
| 2.3 | 授权范围二值 switch（云端实际下发 5 行含 missedNotice；本地默认空数组） | B | 云端 getFamilyInviteData | wxml L40-L46；family-service L271-L302（missedNotice L296-L301）；page-data L144 | **C：每行三态 查看/代录/提醒；删除 missedNotice 行** | O03 |
| 2.4 | 全选按钮（当前把所有 scope.enabled 置 true） | B | 点击 | index.js L70-L75 | C：语义随三级模型重定义（建议只全选 read） | O03 |
| 2.5 | 邀请预览卡（标题/可查看清单/有效期 24 小时） | B | 数据合并 | wxml L50-L60；index.js L77-L87 | C：标题随 owner 称呼（修复硬编码"妈妈邀请…"L82，B-UI-05）；清单按三级权限生成文案 | O04 |
| 2.6 | notice-bar"24 小时内有效，仅可绑定 1 位家属" | B | 静态 | wxml L63 | 保留；补"一位家属只能绑定一位老人"口径（1:1） | O04 |
| 2.7 | 复制邀请说明 / 微信分享（open-type=share，path 带 inviteCode） | B | 点击 | index.js L42-L48、L106-L113 | 保留；分享文案随功能口径更新 | O04 |
| 2.8 | onLoad 自动生成邀请；切换关系/开关/全选各再生成一次（共 4 创建点） | B（不可达） | 交互 | index.js L32、L55、L67、L74；云端 family-service L520-L589 | **C：进入只加载配置，显式"生成/刷新邀请"才创建（A2）** | O05 |
| 2.9 | 提醒电话录入：号码输入框、用途说明、授权勾选、可清空 | **C** | 本期新增 | 无 | decisions 第 2 节第 12 项；A6' | O04 |
| 2.10 | 三级权限说明（代录=血压血糖代录+已服/跳过；不含计划管理与删除） | **C** | 本期新增 | 无 | decisions 第 1 节第 1 项 | O03/O04 |

## 3. 加入页 `pages/family-sub/family-join`

| ID | 状态 | 类 | 触发/条件 | 现状位置 | 决策/计划 | 验收图 |
|---|---|---|---|---|---|---|
| 3.1 | 加载/错误态 | B | 生命周期 | wxml L1-L17 | 保留 | — |
| 3.2 | **无码/错码也显示"邀请有效 · 剩余 24 小时"与默认 scope 列表** | B（半可达，重点缺陷） | 无 inviteCode 进入 | wxml L24 硬编码；云端 family-service L359-L371 通用页 | **C：改为显式错误面板（无效/过期/撤销/已使用/频控），不显示"有效"**（decisions 第 2 节第 9 项；A2） | S08、F02 |
| 3.3 | 有效邀请：邀请人标题、剩余小时、可查看内容清单、加入身份卡 | B（不可达，无有效码） | 有效码 | wxml L20-L51；family-service L311-L358 | C：清单展示三级权限明细（查看/代录/提醒）与电话提醒说明 | F01 |
| 3.4 | 边界勾选（不提供诊断/治疗/处方/急救）+ 未勾选禁用加入 | B | 交互 | wxml L53-L58、L64；index.js L62-L79 | 保留；补"代录数据由家属填写、电话仅用于提醒"文案 | F01 |
| 3.5 | notice-bar"对方可随时修改或撤销你的查看权限" | B | 静态 | wxml L61 | 保留，补"撤销后代录与电话提醒同步失效" | F01 |
| 3.6 | 加入成功 toast"已加入家庭"→ homeFamily | B | 服务端成功 | index.js L80-L90 | 保留 | F01 |
| 3.7 | 服务端拒绝 toast：邀请不存在/已撤销/已被他人使用/已过期/不能加自己 | B（文案在云端，UI 仅 toast） | join 失败 | family-service L603-L619；index.js L91-L96 | C：无效/过期/撤销/已使用改为页面级错误态（同 3.2）；保留 toast 兜底 | F02-F05 |
| 3.8 | **1:1 拒绝："你已绑定一位家人，请先解除原绑定"** | **C** | 家属已 active 关联其他 owner | 现无此校验（getFamilyAccessContext 仅 limit 1，index.js L621-L628） | decisions 第 1 节第 2 项；A1 join 拦截 | F07 |
| 3.9 | 频控提示（当日失败查询超限） | **C** | 同 openId 失败 ≥20 次/日 | 无 attempts 集合 | decisions 第 2 节第 10 项；A2 | F06 |
| 3.10 | 过期判断对无 expiresAt 旧码放行 | B（代码事实） | 旧码 | family-service L612（仅 expiresAt 存在才判过期） | **C：expiresAt 必填、缺失即无效**（decisions 第 3 节第 15 项） | F03 |

## 4. 等待邀请页 `pages/family-sub/family-join-hint`

| ID | 状态 | 类 | 触发/条件 | 现状位置 | 决策/计划 | 验收图 |
|---|---|---|---|---|---|---|
| 4.1 | 加载/错误态 | B | 生命周期 | wxml L1-L13 | 保留 | — |
| 4.2 | 三步说明、notice-bar"家属端不能主动拉取他人记录" | B（可达） | onLoad | wxml L14-L35；static-pages familyJoinHint 数据（L217-L222 附近） | 保留；步骤文案随新流程（电话提醒不改变加入流程） | S07 |
| 4.3 | "去加入家庭"→ 无码 family-join | B（可达） | 点击 | index.js L55-L57 | 保留（3.2 修复后该入口显示的空态会变成"请输入/粘贴邀请码"或无效提示——**具体交互列入 C 设计**） | S08 |
| 4.4 | "查看家属首页"→ home-family 无授权空态 | B（可达） | 点击 | index.js L63-L65；family-service L39-L53 | 保留为空态预览，但建议加"预览模式"标识（**C，防止家属误以为是真实数据**） | S09 |

## 5. 授权管理页 `pages/family-sub/family-auth`

| ID | 状态 | 类 | 触发/条件 | 现状位置 | 决策/计划 | 验收图 |
|---|---|---|---|---|---|---|
| 5.1 | 加载/错误态 | B（不可达） | 生命周期 | wxml L1-L17 | 保留 | — |
| 5.2 | 成员面板：头像硬编码"女"、姓名/关系角色/状态/描述 | B | 云端 getFamilyAuthData | wxml L20-L30（头像 L22） | C：头像改为数据渲染（B-UI-04） | O07 |
| 5.3 | "可查看内容"二值 switch（4 行） | B | 数据 | wxml L32-L43；index.js L63-L74 | **C：三态 查看/代录/提醒**；用药行的 write 文案标注"代确认已服/跳过"；无计划/删除权限行 | O07 |
| 5.4 | "提醒给家属"三开关（漏药/未记录/周报） | B | 数据 | wxml L45-L56；index.js L81-L92 | **C：语义改为"该类提醒信息是否对该家属可见/可电话提醒"；missedNotice 不再出现**；与 scopes.remind 双闸 | O07、F17 |
| 5.5 | 最近查看活动列表 | B | 数据 | wxml L58-L72 | 保留 | O07 |
| 5.6 | 合规 notice-bar、解除授权按钮、保存固定按钮 | B | 静态/交互 | wxml L74-L82；index.js L106-L160 | 保留；解除弹窗文案同步电话/代录终止 | O07/O08 |
| 5.7 | 空 memberId 进入：保存走批量更新、解除走只撤 family_auth 的错误分支 | B（前端存在空串路径） | 无 id 启动 | index.js L19、L40、L110、L143；family-service L476-L502、L759-L788 | **C：memberId 必填校验，缺失即报错并禁用保存/解除（A1）** | 服务端用例为主 |
| 5.8 | 提醒电话字段：查看/修改/清空号码、授权说明 | **C** | A6' | 无 | decisions 第 2 节第 12 项 | O07 |
| 5.9 | 保存成功/失败 toast、解除成功跳回家庭页 | B | 交互 | index.js L116-L126、L144-L151 | 保留 | O08 |

## 6. 家属首页 `pages/family-sub/home-family`

| ID | 状态 | 类 | 触发/条件 | 现状位置 | 决策/计划 | 验收图 |
|---|---|---|---|---|---|---|
| 6.1 | 加载/错误态 | B（半可达） | 生命周期 | wxml L1-L13 | 保留 | — |
| 6.2 | 无授权空态（"当前查看：家属/暂未授权/暂无授权数据/空列表/周报占位"） | B（半可达，经 4.4） | accessContext=null | wxml L14-L94；family-service L39-L53 | 保留；C：经等待邀请页进入时加"预览模式"标识（同 4.4） | S09 |
| 6.3 | 头部"当前查看：{owner}"、已授权 scopeText、"切换"按钮 | B（有授权态不可达） | 关系 active | wxml L15-L23 | C："切换"在 1:1 模型下改为返回/说明（每位家属仅一位老人，不存在切换对象；B-UI-03） | F08 |
| 6.4 | 今日关注（title/meta + 查看→medConfirm） | B | 云端聚合 | wxml L24-L31 | C：作为 noticeRules 提醒信息的承载区（漏药/未记录/周报按开关显隐，F17） | F08/F17 |
| 6.5 | 快捷查看三宫格，**"趋势"重复两次** | B（缺陷，半可达即可见） | 渲染 | wxml L36-L38 | **C：修复重复卡；改为与 read 四块一致的入口并按权限显隐**（B-UI-01） | S09、F08 |
| 6.6 | 最新记录 metric 卡 → recordDetail（不带 owner） | B | 点击 | wxml L47-L60；index.js L80-L82 | C：家属态携带 owner 上下文、按 BP/BG read 显隐（A3） | F09/F19 |
| 6.7 | 今日用药行（时间/药名/剂量/状态；待确认 action → medConfirm） | B | 云端 | wxml L63-L80；index.js L89-L95 | C：read(medicine) 显隐；write(medicine) 时出现"已服/跳过"代确认按钮（A4），无 write 仅查看 | F08/F10/F11 |
| 6.8 | 本周周报面板 → trend | B | 云端 | wxml L83-L89；index.js L113-L115 | C：按 read(report) 显隐 | F09 |
| 6.9 | 合规 notice-bar（不提供诊断/治疗/处方/急救） | B | 静态 | wxml L91-L93 | 保留；补代录/电话边界句 | F08 |
| 6.10 | **"电话提醒"入口（remind 任一为 true 且有号码）** | **C** | A6' | 无任何 makePhoneCall 代码（全仓 grep 无命中） | decisions 第 1 节第 4 项、第 2 节第 12 项 | F13 |
| 6.11 | 号码脱敏展示（138****1234）；点击后微信拨号系统弹窗（含完整号码），弹窗内说明"系统拨号将显示完整号码" | **C** | A6' | 无 | decisions 第 2 节第 12 项；只拍到系统弹窗，不实际拨出 | F13 |
| 6.12 | remind=true 但 owner 未配置号码：置灰/提示"对方尚未配置提醒电话" | **C** | 号码空 | 无 | A6' | F14 |
| 6.13 | owner 清空号码后家属端入口消失/更新 | **C** | 号码被清空 | 无 | A6' + onShow 刷新（现 onShow 已有 reload，L47-L53） | F15 |
| 6.14 | remind=false：无号码下发、无电话入口 | **C**（UI 与服务端双层） | 权限 | 无 | UI 隐藏 + 服务端不返回号码（**以抓包/云日志为准**） | F16 |
| 6.15 | 授权撤销后：重新进入/刷新回到无授权空态，号码与数据均消失 | **C**（含弱网边界） | owner 撤销 | 现无 id 撤销不删 family_members，家属仍可读（family-service L759-L782 × index.js L621-L636） | A1+A5：撤销即时生效；弱网 stale 缓存 TTL 处理（core.js L237-L239） | F18 |
| 6.16 | 用药卡片状态被本机确认串改的显示串扰 | B（代码疑点，待验证） | 家属本人有同 logId 计划 | medication-merge L237-L256；api.js L261 | A3 修复（家属态不合入本机状态） | 服务端/构造用例 |

## 7. 二级页（trend / recordList / recordDetail / medList / medConfirm / 记录录入页）

| ID | 状态 | 类 | 现状位置 | 决策/计划 | 验收图 |
|---|---|---|---|---|---|
| 7.1 | 全部按本人 _openid 取数，无 owner 概念 | B（代码事实） | record-service/report-service/medication-service grep 零 family 字样；medication 读 L41/L51/L183/L225-L226/L244 | A3：服务端受控 owner 读分支（关系+read 双校验） | F19 |
| 7.2 | 家属从 home-family 跳入看到本人空数据/本人数据 | B（半可达，S11 留证） | home-family/index.js L71-L115 不带 owner | A3：路由携带 owner 上下文、头部"正在查看 {owner}"、按 read 渲染 | S11、F19 |
| 7.3 | 血压/血糖代录页（家属态，write=BP/BG） | **C** | 无 | A4；记录归属 owner、代录人字段 createdByMemberOpenId、页面标注"代家人记录" | F10 |
| 7.4 | 已服/跳过代确认（medConfirm 家属态） | **C** | 现 confirmMedication 写死本人（medication-service L383-L432） | A4：owner 入参+write(medicine) 校验 | F10 |
| 7.5 | 家属态**无用药计划增删改入口、无记录删除入口**（write=true 也不出现） | **C** | 现计划保存/删除记录均本人归属（medication L324-L352；index.js deleteRecord L1260-L1275） | decisions 第 1 节第 1 项；UI 不渲染 + 服务端拒绝双保险 | F12 |
| 7.6 | 代录记录在详情/列表显示"由 {家属关系} 代录" | **C** | 无 | A4 审计字段展示 | F10 |
| 7.7 | 无 read 的家属直接访问二级 URL：无数据/无权限提示 | **C** | pre-check 只校验 onboarding（L207-L244） | A3：服务端拒绝 + 前端无权限态页 | 服务端用例+F09 |

## 8. 中转死页 `pages/family-sub/index`

| ID | 状态 | 类 | 现状位置 | 决策/计划 | 验收图 |
|---|---|---|---|---|---|
| 8.1 | 三张卡片（邀请/加入/授权） | B（死页，无入口） | index.wxml 全文；index.js L12-L22；app.json L52 | **C：删除四件套与注册项**（decisions 第 2 节第 8 项） | U04 留档后删除 |

## 9. 横切能力覆盖核对（对应用户任务二清单）

| 要求 | 矩阵状态 ID | 类 |
|---|---|---|
| 血压/血糖/用药/周报四类 read | 6.5-6.8、7.1-7.2（B 雏形：仅 homeFamily 块级过滤）；家属态二级页 7.2/7.7（C） | B+C |
| 血压/血糖代录 | 7.3、7.6 | C |
| 已服/跳过代确认 | 6.7、7.4 | C |
| 家属不能管理计划/删除记录 | 7.5 | C |
| remind 电话提醒入口 | 6.10-6.11、2.9、5.8 | C |
| 未授权提醒（无关系空态） | 6.2（B 已有空态文案）、4.4（B 可达） | B（保留+加预览标识 C） |
| 未配置号码 | 6.12 | C |
| 号码清空 | 6.13、5.8 | C |
| 授权撤销 | 1.7（B 弹窗）、6.15（C 即时生效与弱网） | B+C |
| 列表号码脱敏 + 拨号说明 | 1.6/6.11 | C |
| noticeRules 控制的提醒信息 | 5.4、6.4、6.9 区 | B（开关存在）+ C（赋予可见性语义与承载区） |
| 已绑定其他老人拒绝 | 3.8 | C |
| 邀请无效/过期/撤销/已使用/频控 | 3.2、3.7、3.9、3.10 | B（toast 文案部分存在）+ C（页面级错误态+频控+必填过期） |
| 关系 8 种 | 2.2 | C（现 4 种 B） |
| missedNotice 并入 noticeRules | 2.3、5.4 | C（删除第 5 scope） |
| 不兼容存量、无 enabled 映射 | 全 C 状态直接落三级；归一化缺字段按 false | C（decisions 第 1 节第 7 项） |
| Tab 放开/死页删除/回滚/文案 | 1.9-1.11、8.1 | C |

## 10. 不能由截图/本矩阵证明的事项（实施期证据要求）

1. 服务端按 read 不返回数据、write 拒绝越权、remind 不下发号码：以云函数 Jest/回归（B1-B3 护栏恢复后）与抓包/云日志为准。
2. 撤销在云端即时生效、1:1 拦截、频控计数、唯一索引：服务端用例 + 云控制台索引截图。
3. `wx.makePhoneCall` 只验到系统拨号弹窗，不实际拨出。
4. 所有 C 类状态在实现并截图前，不得在任何对外材料中表述为"已具备"。

---

## 11. 补图后的状态修订（2026-09-22 追加，6 张截图均为**用户手动提供**，目录 `screenshots/`）

### 11.1 由 B 升级为"截图已证实现象"的行

| 矩阵行 | 截图 | 修订内容 |
|---|---|---|
| 1.1/1.2/1.3（占位与入口） | `S01-家庭Tab占位-2026-09-22.jpg` | 干净版（无调试条）再次证实，作为正式开发前基线 |
| 3.2（无码伪装有效邀请） | `S8-加入页 family-join 无邀请码状态-2026-09-22.jpg` | **B-UI-02 确证**：无码显示"邀请有效·剩余 24 小时"，四项默认 scope 全 ✓（family-service L359-L371 兜底 + index.js L354-L381 默认四 scope + wxml L24 硬编码） |
| 4.2/4.3/4.4（等待邀请页与两入口） | `S7-等待邀请页 family-join-hint-2026-09-22.jpg` | 三步卡、notice、"去加入家庭/查看家属首页"两按钮均真实渲染，onboarding 路径可达性确证 |
| 6.2（无授权空态） | `S9-家属首页 home-family 无授权空态-2026-09-22.jpg` | "当前查看：家属/已授权：暂未授权/暂无授权数据/空最新记录/空今日用药面板"逐屏证实；导航标题实测为"**家人健康**"（home-family/index.js L35-L37） |
| 6.5（重复趋势卡） | 同 S9 | **B-UI-01 确证**：快捷查看区第 1、3 格均为"趋势"（wxml L36/L38 完全相同） |
| V03（订阅按钮无真实订阅） | `S02-订阅上线通知弹窗-2026-09-22 .jpg` | 弹窗"即将上线/家庭协同正在开发中，将在后续版本中上线，感谢你的关注与耐心等待！/知道了"，与 coming-soon/index.js L29-L35 逐字一致；无取消键、无授权流程 |
| 角色选择页（新增 12.1） | `S06-角色选择页-2026-09-22.jpg` | 两角色卡、默认选中"本人使用"、蓝色 notice、固定"继续"均真实渲染（static-pages.js L205-L211、role/index.wxml L15-L45） |

### 11.2 新增 B 类行（补图暴露，尚未运行/点击验证）

| ID | 状态 | 类 | 触发/条件 | 现状位置 | 截图 |
|---|---|---|---|---|---|
| 6.17 | 无授权空态下"今日关注·查看"按钮无条件渲染且可点，点击 goMedConfirm 进入**本人**用药确认页（无 owner 上下文），空态引导指向错误页面（**B-UI-07**） | B（截图证实按钮存在，落点待点击） | accessContext=null | home-family/index.wxml L24-L31（无 wx:if）、index.js L103-L105 | S9 |
| 12.1 | 角色页副文案"角色后续可以在'我的'里调整"，但"我的"页代码中**未找到角色调整入口**（仅 me/index.wxml L20 展示角色文本；role 页仅由 privacy/index.js L100 onboarding 跳入）（**B-UI-08**） | B（代码检索事实，待人工点击"我的"复核） | onboarding 后 | role/index.wxml L18；pages/me 全目录 | S06 |
| 12.2 | 角色页"继续"按钮在截图中呈浅色，与默认 selectedRole='self' 时应启用（wxml L45 disabled 取反）存在视觉疑问 | B（待点击） | 进入角色页 | role/index.wxml L45；static-pages.js L207 | S06 |
| 3.11 | 加入页固定"加入家庭"按钮在该视口遮挡边界勾选行（"我已知晓：康小记仅用…"仅隐约露出），可能需要先下滑才能勾选（**B-UI-09**） | B（截图可见遮挡，交互待验证） | 固定按钮 + 内容高度 | family-join/index.wxml L53-L64 | S08 |

### 11.3 仍维持原判断、未被截图改变的项

- 6.3 的 **B-UI-03（切换落点）**：S09 只证明"切换"按钮存在；点击后是否跳回家庭 Tab 占位仍未验证，继续标 B。
- B-UI-04（授权页头像硬编码"女"）、B-UI-05（邀请预览硬编码"妈妈邀请"）：U01/U02 不可达，无新证据。
- S08 折叠区下方的 notice-bar（family-join wxml L61）、S09 底部合规 notice-bar（home-family wxml L92）与完整周报面板未入镜，不做有无结论。
- S09 的空数据是该账号无关系时的**设计空态**（family-service L39-L53），**不能证明服务端会拒绝越权访问**；B-UI-07 的点击落点、S10/S11 二级页数据主体问题仍待点击与服务端证据。
- 全部 C 类状态无新证据，保持"设计态、无截图、无代码"。
