# A7 数据流审查：家庭 Tab 正式开放、死页与回滚开关

## 1. 现有局部改动审计（实现前现状）

| 项 | 审计结果 |
|---|---|
| pages/family/index.wxml | 真实家庭页已放开（wx:else 全量渲染），仅注释声明"本地测试期开放"，**无运行时开关** |
| components/coming-soon | 四文件已删除（git 状态 D）；全仓 wxml/json/js **零引用**（grep 核实） |
| pages/family-sub/index | 四文件仍在磁盘；内容为 3 个跳转按钮的死页；routes.js 无键、全仓无路径引用；**app.json 分包仍注册 "index"**（本批删除） |
| 运行时回滚开关 | 不存在；全仓无 appConfig/featureFlag/envVersion 既有模式（grep 核实）→ 本批新建 |

## 2. 开关设计（可执行的运行时判断，非注释承诺）

判定优先级（utils/feature-flags.js，纯函数、单点实现）：
1. **远程配置**：healthApi key `appConfig` → `familyTabEnabled`，严格布尔才生效；
2. **端侧默认**：`wx.getAccountInfoSync().miniProgram.envVersion` —— release=false（正式版默认关）；trial/develop=true（体验版默认开）。两类默认值明确区分且有单测固定；
3. envVersion 获取异常 → 按 release（保守关闭）；远程获取失败/未部署/超时 → 回退端侧默认，不阻塞页面。

生效点（pages/family/index.js）：
- data 初始值 = 模块加载时端侧默认（首帧即正确占位/真实态，无闪烁）；
- onLoad：同步应用开关 → 开则加载数据，关则复位 isLoading 展示占位；随后异步 `refreshFamilyTabFlag()` 拉取远程配置一次并重估（关→开时补加载）；
- onShow：重估开关（tabBar 切回即生效）；关闭时直接返回，不加载数据；
- 远程配置缓存于 `getApp().globalData.appConfig`（undefined=未拉取 / null=失败或无 / 对象=配置），进程级，不落长期存储。

**边界**：开关只控制家庭 Tab 展示与家庭页数据加载；不构成任何数据授权——家属数据授权一律走服务端 family-policy 闸口（A3/A4/A5/A6 口径不变）。其他 Tab/页面零引用 feature-flags（文件系统扫描测试固定）。

## 3. 远程配置的云端侧（含控制台影响说明，未擅自创建）

- 新增只读 key 路由 `appConfig` → `getAppConfigData()`：读 `app_configs` 集合 `_id='app_config'` 单文档，仅提取布尔 `familyTabEnabled`；集合缺失/无权限/文档不存在/字段非布尔 → 一律返回 `{familyTabEnabled:null}`（端侧走默认）。
- **不新增任何云端资源**：`app_configs` 集合本批未创建（今晚不操作云端）。影响说明：未创建时远程开关不可用、端侧默认生效（正式版关/体验版开），无故障面；若需远程一键回滚/放开，控制台待办 = 创建集合 `app_configs` + 写入文档 `{_id:'app_config', familyTabEnabled:boolean}` + 安全规则"仅云函数读写"（与其余集合同口径），随部署清单执行。
- 该路由为读接口，不写库、不涉身份数据，任何账号调用返回同一配置。

## 4. 死页删除

- 删除 pages/family-sub/index.{js,json,wxml,wxss}；app.json family-sub 分包注册项移除 "index"。
- 删除前确认（测试固化为文件系统契约）：routes.js 无键、全仓无 `family-sub/index` 引用；family-invite/family-join/family-join-hint/family-auth/home-family 五路由注册与 routes 键**完整保留**；tabBar `pages/family/index` 注册不变。

## 5. 家庭页状态保留与合规文案

- 状态分支：isLoading（加载态）→ loadError（失败 + 重新加载按钮）→ **!familyTabEnabled（A7 新增占位态）** → 真实页（空成员 empty-panel / 成员列表含状态徽标 待加入·已授权·已解除 / 预览卡 bound=false 无操作按钮）。
- 成员状态显示链：服务端 getFamilyData（active 关系行 + 邀请预览卡）→ services/family normalizeMemberStatus（pending→待加入、active→已授权、revoked→已解除）→ 页面透传渲染；页面测试以三态数据固定。
- 合规文案复核：share-meta"不包含诊疗或处方建议"、notice-bar 更新为"共享内容仅限你授权的范围，你可以随时修改或取消家属授权。家属看到的是记录和提醒状态，不代表医生诊断或治疗建议。"（家庭共享/非诊疗/授权可撤回三要素齐备）；占位态文案同样携带授权范围与撤回表述；电话用途条款在 A6 已补入 static-pages 隐私政策与用户协议。

## 6. 表述边界

- 家庭 Tab 打开 ≠ A3/A4/A5/A6 已完成：云端仍为 A3 版（含装配缺陷），A4/A5/A6/A7 代码全部未部署；正式版发布前开关默认关闭即为回滚保底。
- 未部署、未上传体验版；远程开关的云端行为（app_configs 读取）属部署+控制台操作后验证项。
