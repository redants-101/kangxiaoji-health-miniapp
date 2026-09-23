# A3 验收发现修复（双趋势入口 / 家属趋势不可见）· 摘要（2026-09-23）

- 触发：双手机验收中家属（B）反馈：① home-family"快捷查看"出现两个"趋势"；② 点趋势看不到老人（owner）的趋势信息。
- 性质：均为**客户端缺陷**（存量 + A3 遗漏），服务端闸口无问题；本批零云端改动、无需重新部署云函数；**但修复在小程序端，需随下一次体验版上传生效**。

## 1. 问题 1：两个"趋势"

- 根因：`pages/family-sub/home-family/index.wxml` 快捷区第三个 `quick-action` 是第一个的复制残留（title/route 完全相同），存量缺陷（HEAD 即存在，原型稿无第三项设计依据）。
- 修复：删除重复项，快捷区保留 趋势 + 用药 两项（最小修复，不发明新入口；若产品希望第三槽位（如"记录"），另作设计决策）。

## 2. 问题 2：家属点趋势看不到老人数据

- 根因：familyView 上下文经 `app.globalData.familyView` 传递，但 **trend 页只在 onLoad 读取**；trend 是 tabBar 页，从 home-family 经 switchTab 进入时只触发 onShow → `isFamilyView` 保持 false → 走 self 路径（B 自身空数据）。另 home-family 自身未在 onLoad/onShow 置全局标记（仅快捷入口点击时置）。
- 修复：
  1. `home-family/index.js` onLoad/onShow 置 `app.globalData.familyView = true`（本页即家属视图）；
  2. `trend/index.js` onShow 重判全局标记，变化时 `setData({isFamilyView, familyDenied:false})` 并重载（tabBar 切换不触发 onLoad 的补偿）。
- 回归守卫：`tests/unit/a3-family-readonly.test.js` 新增"trend tabBar 切换重判家属上下文"用例（onShow 检测标记后以 familyView 重载，loader 第三参为真）；该用例先失败后通过（15/15）。

## 3. 验证（真实退出码）

| 检查 | 退出码 | 结果 |
|---|---|---|
| A3 目标测试（含新守卫） | 0 | 15/15 |
| 全量 Jest | 1 | 553/555；2 失败 = settings 时区台账（执行时北京 ~02:0x 窗口内；不掩盖） |
| npm run regression | 0 | ok |
| npm run lint | 1 | 43（11e/32w）零新增 |

## 4. 补丁与生效路径

- `fix.patch`（4 段：home-family wxml/js、trend js、a3 测试）：基线 = A3 批末态，验证干净应用且 4 文件逐字一致。
- **生效路径**：小程序端改动，需随下一次体验版上传生效（体验版上传仍待用户手动，见 deploy-record-a3.md §4）；云函数无需重部署。
- 验收复核建议：上传后 B 重进 home-family → 快捷区仅两项；点趋势（或 tabBar 切趋势）应显示老人趋势（familyView 响应 allowed=true）。

## 5. 边界

- 未改云端；未进入 A4；未上传体验版；
- settings 时区台账保留；S01/S06 缺口保留；
- 若产品后续要求快捷区第三槽位（如"记录"recordList 家属视图），属设计决策另批处理。
