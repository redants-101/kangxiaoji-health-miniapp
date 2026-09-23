# 体验版上传手册（人工操作）— 2026-09-23

CLI 上传已尝试 1 次并失败（GENERIC_ERROR，微信开发者工具 electron 通道既有故障，与 A3 批次同因；未重试、未成功）。请按以下步骤人工上传。

## 步骤

1. 打开**微信开发者工具**（稳定版）。
2. 确认打开的项目目录为：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`（appid wxcb…fb）。
3. 确认编译使用**当前工作区**（未提交改动即待上传内容）：模拟器正常渲染、无编译错误；可抽查家庭 Tab——工具内 envVersion=develop → 开关默认开，应显示真实家庭页。
4. 点击工具栏"**上传**"。
5. 版本号：`0.10.0`；版本描述（建议照填）：
   > A3 家属只读 + A4 家属代录 + A5 撤销缓存治理 + A6 电话提醒 + A7 家庭 Tab 测试版
6. 上传成功后，登录 [公众平台](https://mp.weixin.qq.com) → 版本管理 → 开发版本 → 将 0.10.0 **设为体验版**（体验成员含手机 A/B 账号）。
7. 回填记录：体验版版本号、上传时间、设置时间，追加到本目录 `deploy-record.md` §6 或新建 `upload-record.md`。

## 上传内容核对（本包相对上一体验版 0.9.0 的增量）

- A3 验收修复：home-family 趋势重复入口删除、trend onShow 重估 familyView；
- A4 页面：home-family 家属代录入口、record-bp/record-bg 家属态提交、med-list 家属代确认/撤销；
- A5：services/core 家族读零缓存与拒绝不回填、page-factory 请求序号、services/family 精准失效；
- A6 页面：home-family 电话提醒入口+readPermissions 门控、family-auth 提醒电话编辑区、family-invite 电话+授权勾选；
- A7：utils/feature-flags.js、家庭页运行时开关+占位态、app.json 死页注销（pages/family-sub/index 已删除）；
- 打包排除项不变（packOptions：tests/evidence/cloudfunctions/docs/scripts/node_modules 等 27 项）。

## 注意

- 体验版 envVersion=trial → **家庭 Tab 默认开**（A4–A6 功能对体验成员可见），与既定验收口径一致；
- 云端已部署 A4–A7（10:52:20），前端上传后即为完整验收态；
- 若上传报"代码包超限"，先确认 packOptions ignore 生效（主包应 <1.5M，A2 批次已治理）；仍失败则截图报错交回处理，不要自行删除文件。
