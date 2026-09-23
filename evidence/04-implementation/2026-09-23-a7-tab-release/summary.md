# A7 子批次总结（家庭 Tab 正式开放、死页与回滚开关）— 2026-09-23 夜间批次

分支 `feat/family-permission`（HEAD `a751776`）。本子批次未提交、未切分支、未部署、未上传体验版、未创建任何云端资源。

## 变更（12 项 = 6 改 + 2 新 + 4 删）

- 新增 `utils/feature-flags.js`：运行时开关单点实现（远程布尔 > envVersion 默认：release=关、trial/develop=开；异常保守关）。
- `pages/family/index.{js,wxml,wxss}`：onLoad/onShow 运行时判定 + 异步远程重估；占位态分支（非注释性回滚）；notice-bar 合规文案补"共享仅限授权范围、可随时修改或取消"。
- `app.json`：family-sub 分包移除死页 "index" 注册。
- 删除 `pages/family-sub/index.{js,json,wxml,wxss}`（死页；删除前确认全仓无引用、routes 无键，测试固化为文件系统契约）。
- `utils/api.js`：`getAppConfig()`（失败返回 null 走端侧默认）。
- `cloudfunctions/healthApi/index.js`：COLLECTIONS.appConfigs（注释说明控制台待办与回退）+ `getAppConfigData()` + keyMap `appConfig`（只读，任何异常回退 familyTabEnabled:null）。
- 新增 `tests/unit/a7-tab-release.test.js`（14 用例）。

## 测试

- 测试先行：before.txt = 套件实现前无法运行（`Cannot find module '../../utils/feature-flags'`，模块随实现创建——失败输出原样保留）。
- 实现后：A7 目标 14/14（after.txt），覆盖需求清单：开关开→真实页、开关关→占位、远程覆盖两方向、获取失败回退、加载失败+重载、空成员、pending/active/revoked 三态、邀请/管理/撤销入口（含 A1 预览卡守卫）、死页删除后路由一致性、owner/member 页面不混淆（家庭页不置 familyView 全局标记）、开关不影响其他 Tab（feature-flags 引用范围扫描）。
- 全量 Jest：631/633 —— 仅 2 失败为 settings.test.js 时区对（北京时间 00:00–08:00 窗口，单独记录，未掩盖）。
- regression：ok；lint：43 problems（11e/32w）与基线一致。**cloudfunctions/ 不在现有 lint 范围**（本批改了 healthApi/index.js，明确写出）。

## fix.patch

12 个 diff 段（含 4 个删除段）；基线 = pre-a7（pre-a6 + A6 补丁）；校验 APPLIED-CLEAN + 8/8 改/新文件逐字节 MATCH + 4/4 删除文件确认不存在。

## 状态口径

- **本地已验证**：上述全部。
- **代码已完成但未部署**：A7 全部（云端 appConfig 路由 + 前端开关/死页删除）。
- **需要 CloudBase 控制台操作（可选，远程开关启用时）**：创建集合 `app_configs`、写入 `{_id:'app_config', familyTabEnabled:boolean}`、安全规则仅云函数读写。未创建时无故障面（端侧默认生效）。
- **云端待验证**：appConfig 路由部署后真实响应；远程改配置 → 端侧 onShow 生效链路。
- **正式发布默认值口径**：release 默认**关**（占位态）——正式发布时若要开放家庭 Tab，需远程配置置 true 或随发布批次修改默认值并重新走验收；体验版默认开（便于双手机验证）。
- **不因 Tab 打开宣称 A3–A6 完成**：云端仍为 A3 版（含装配缺陷），A4–A7 全部未部署。
