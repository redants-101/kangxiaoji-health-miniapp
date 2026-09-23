# A2 页面收尾 · 显式生成邀请 · 摘要

- 日期：2026-09-22（20:10–20:40，UTC+8）
- 仓库/分支/HEAD：`xiaochengxu` / `feat/family-permission` / `a751776`
- 范围：仅 family-invite 页面（js+wxml）与其页面级测试；不改云端权限规则、不改默认预选策略、不重做视觉；本批不操作真实邀请、不改云端数据、不部署、不上传、不提交、不清理。

## 1. 复现（before.txt）

页面级测试（mock utils/api 与 page-factory，捕获 Page 配置实例化）对**修正前**页面运行：**12/12 失败**，确认：

- onLoad / reloadPage 各触发 1 次 createFamilyInvite（打开即生成、刷新即重生成并覆盖当前邀请）；
- selectRelation / toggleScope / selectAllScopes 每次编辑都触发 createFamilyInvite（编辑即写云端）；
- 无 submitting 防重、无失败态标记、无脏草稿门禁（复制/分享可携带"新文案+旧码"）。

## 2. 最小修正（3 个文件）

**pages/family-sub/family-invite/index.js**（重写页面逻辑，保持既有结构与视觉类名）：

1. onLoad/reloadPage 只 `loadData + updateInvitePreview`，**零生成请求**；
2. selectRelation/toggleScope/selectAllScopes 只更新草稿与预览文案，**不写云端**；selectAllScopes 只开 read+remind（代录须逐块显式开，未夹带改预选策略——默认预选仍由云端 getFamilyInviteData 提供）；
3. 新增 `generateInvite`：用户点击才提交；已有码时先 `wx.showModal` 明确"重新生成后旧邀请码立即失效"；`submitting` 防在途重复提交；
4. 失败态：`submitting` 复位、`generateError` 提示、**旧码保留但 draftDirty=true**——不把旧码展示为本次新配置已生效；
5. 脏草稿门禁：`copyInvite` 与 `onShareAppMessage` 在 `!inviteCode || draftDirty` 时拦截/回退无码路径，提示重新生成；wxml 复制/分享按钮同步 disabled；
6. wxml 增加"生成邀请"按钮（loading/disabled）、邀请码展示、脏草稿与未生成提示文案；scope 三开关结构沿用既有标记（read/代录(report 隐藏)/提醒）。

**tests/unit/a2-explicit-invite.test.js**（新增 12 用例）：打开/刷新/编辑零生成；点击生成一次；在途重复点击仅一次；已有码重生成需确认且文案含"失效"；失败态（无码/有旧码两形态）；脏草稿复制拦截与分享回退无码；未生成分享回退；重新生成成功后 preview/sharePath/code 与草稿一致且复制放行。

## 3. 验证（真实退出码）

| 检查 | 退出码 | 结果 |
|---|---|---|
| 目标测试（修正后） | 0 | **12/12**（after.txt） |
| 全量 Jest | 0 | **540/540，23 套件**（full-test.txt） |
| npm run regression | 0 | ok（regression.txt） |
| npm run lint | 1 | 11 error/32 warning，**零新增**（lint.txt；invite 页在 lint 范围内，计数未变） |

未删任何断言；before/after 对照见 before.txt / after.txt。

## 4. 补丁与边界

- `fix.patch` 3 段（invite js、invite wxml、新测试），基线 = 含 preflight 补丁的完整链；已验证干净应用且与工作区逐字一致。
- 页面改动在小程序端，**无需重新部署云函数**即可在开发者工具本地编译生效；本批未部署、未上传体验版。
- 云端 getFamilyInviteData 仍返回默认预选（未夹带修改）；页面刷新后不感知"云端已存在的旧邀请码"——重新生成确认弹窗的失效说明覆盖该情形（保守方向：用户主动确认才会作废旧码）。

## 5. 联调文档同步更新

`evidence/07-verification/2026-09-22-preflight/integration-steps-s02-abc.md` 升级 v2：删除"打开即生成"与"覆盖历史文档可接受"；新增生成前核对（存在未确认用途邀请即停下）；编译路径与启动参数分填；A 生成/B 查看分工；改权剔除验证须有脱敏测试记录（空数据不能证明剔除）。

## 6. 截图证据结案（2026-09-23 追加）

- 已有截图并核验（7 张）：S02、S03a、S03b、S04、S05、S07、S08；其中 S04/S05 为真机截图，S05 满足"仅接受 REVOKED"口径；S03a 双扩展名已由用户重命名修正（验收记录保留偏差记载）。
- 代码和接口已验证但无截图：显式生成的防重/失败态/脏草稿门禁/重生成确认（页面级 Jest 12/12、CLI 冒烟）。
- 因测试条件不足待补：S06（缺第三独立微信账号 C，待第三账号验证，不伪造等价截图）。
- 不影响本批代码验收的证据缺口：S01 加载瞬态未稳定捕获，标记未提供（通用 isLoading 模板，无独立业务逻辑）。
- 结案明细与 A3 前置条件见 `evidence/07-verification/2026-09-22-preflight/screenshot-acceptance.md` §5；文章证据矩阵同步见上级目录 `文章证据矩阵.md` §七。
- 本批代码验收结论不变：显式生成行为由测试+冒烟+7 张截图共同支撑；S01/S06 缺口不改变该结论。
