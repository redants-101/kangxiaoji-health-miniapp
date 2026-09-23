# A3 双手机验收脚本与截图准备（2026-09-23，待执行）

前置（缺一不可，未满足不开始）：
1. A3 云函数已部署（部署前发 v3 快照），冒烟：familyView 探测对无绑定账号返回 `familyView.allowed=false, reason=noBinding`；
2. 体验版上传决策已定（含/不含家庭 Tab，见 preflight-report §6.1）；
3. 账号 A（owner，真机甲 + 或开发者工具）、账号 B（家属，真机乙）；脱敏昵称；
4. 开发者工具（登录 A）用于网络证据抓取；真机乙用于家属视角截图；
5. 验收产生数据（邀请/绑定/记录）为测试数据，验收后清理方式已确认。

## 准备步骤

- P1（A，工具或真机甲）：家庭页 → 邀请家属 → 调整权限（血压/血糖/用药 read 全开）→ 生成邀请 → 记录邀请码；
- P2（B，真机乙）：扫码/输入码进入加入页 → 勾选边界说明 → 加入家庭；
- P3（A）：家庭页确认成员列表出现 B（状态"已授权"）。

## 验收项（9 项，逐项标注验证层级）

| # | 操作 | 预期 | 层级 |
|---|---|---|---|
| 1 | B 打开家属首页 home-family | 显示 A 的姓名、授权范围文案、最新指标与用药待办 | 服务端响应已验证（A3 前既有 getHomeFamilyData）+ 页面呈现待截图 F01 |
| 2 | B 进 trend（血压血糖标签） | 图表与记录为 A 的数据；工具 Network（或真机抓包）中 trend 响应 `familyView.allowed=true, readOnly=true` | 服务端响应已验证（需同次网络证据）+ 页面 F02 |
| 3 | B 切 trend 用药标签 | 用药合规图表为 A 的确认数据；响应 metric=medication 且 allowed=true | 服务端响应已验证 + 页面 F02 同页 |
| 4 | B 进 recordList / 点记录进 recordDetail | 列表仅含 read 开放类型；detail 正常；若 bg read 关闭则列表无血糖记录、直接构造 bg 详情 id 返回 scopeDenied | 服务端响应已验证（allowedTypes 过滤）+ 页面只读状态已验证（无删除按钮） |
| 5 | B 进 medList / medHistory | 展示 A 的计划与历史；**无**添加用药按钮、无编辑/长按菜单、无确认/撤销按钮；顶部只读横幅 | 页面只读状态已验证 + 服务端只读（medList 响应 readOnly=true） |
| 6 | B 逐页检查写入口 | 编辑、删除、计划增删改、确认入口均不出现（wxml 隐藏）；js 守卫兜底（点击无响应+toast） | 页面只读状态已验证（非仅隐藏：服务端写路由仍按 _openid 归属拒绝，可用工具直调写 action 负向验证，可选） |
| 7 | A 关闭 B 的血糖 read → 保存 → B 刷新 recordList/trend | B 的响应中**不含**血糖记录（recordList records 无 type=bg；trend bpBg 返回 scopeDenied 或按开放块返回）；A 侧不受影响 | 服务端响应已验证（需同次网络证据）+ 页面 F03 |
| 8 | A 撤销 B → B 刷新任一二级页 | 响应 `familyView.allowed=false, reason=revoked`；页面拒绝面板 | 服务端响应已验证 + 页面 F05 |
| 9 | A 自查：记录/编辑/删除/用药计划/确认 | 全部原有能力不变（owner 路径不携带 familyView，行为与 A3 前一致） | 服务端响应已验证（owner 回归）+ 页面抽查 |

层级定义：**服务端响应已验证**=有同次接口响应证据（工具 Network 导出或抓包截图，脱敏）；**页面只读状态已验证**=页面入口缺失/守卫生效且有截图；**仅页面隐藏**=只做了 wxml 隐藏、服务端未过滤（A3 不存在此档，若发现即缺陷）；**尚未验证**=本轮未执行项。

## 截图清单（evidence/04-implementation/visual-input/screenshots/）

| 文件 | 内容 | 绑定网络证据 |
|---|---|---|
| A3-F01-home-family-member-YYYY-MM-DD.png | B 家属首页（A 姓名+授权范围+指标） | 同次 homeFamily 响应（脱敏：隐去 openId/记录细节） |
| A3-F02-trend-read-YYYY-MM-DD.png | B trend 血压血糖图表（或用药标签页） | 同次 trend 响应 familyView 字段 |
| A3-F03-record-scope-denied-YYYY-MM-DD.png | 关闭某 read 后 B 的拒绝面板或空列表 | 同次 recordList/trend 响应（scopeDenied 或无该类型记录） |
| A3-F04-medication-readonly-YYYY-MM-DD.png | B medList 只读态（无添加/编辑/确认/撤销） | 同次 medList 响应 readOnly=true |
| A3-F05-revoked-family-view-YYYY-MM-DD.png | 撤销后 B 二级页拒绝面板 | 同次响应 reason=revoked |

网络证据获取：优先开发者工具（登录 B）Network 面板导出 HAR 或截图（隐去 openId、记录数值可保留为测试值）；真机乙若无抓包条件，则服务端证据以工具同账号复现响应替代并在登记表注明"真机截图 + 工具响应证据分离"。**截图不能单独证明服务端过滤**，必须与响应证据配对归档。

## 本轮状态

本脚本待执行：未部署、未上传、未产生验收数据、未截图。执行顺序：preflight-report §6 待确认项 → 部署 → 冒烟 → P1-P3 → 验收 1-9 → 截图 F01-F05 → 数据清理。

## 执行状态更新（2026-09-23 01:35）

- 云端 A3 已部署（01:22:30，v3 快照在列）；冒烟 5 项通过（见 deploy-record-a3.md）。
- **体验版上传未完成**：DevTools CLI upload 受 electron winId 缺陷阻断（islogin=true、open 成功仍报 winId not found）；转用户手动：IDE 工具栏上传 0.9.0 → 公众平台设为体验版；或重启 IDE 后重试 CLI。
- 双手机验收待人工执行：P1–P3 与验收 1–9、截图 F01–F05。
- 服务端佐证与验收后清理可由助手代跑（下一轮）：B 的 openId 从 `tcb fn log healthApi` 的 familyView 调用 userInfo 获取；响应证据用 `tcb fn invoke`/只读查询导出；清理按 openId/邀请码精确删除。
- 遗留：family_invite_attempts 剩余 4 条为上一轮真机 S07 测试计数（TTL 自动清理）。
