# A3 部署前核验与双手机验收准备 · 摘要（2026-09-23）

- 批次：实施批次 A3-preflight（部署前核验 + 验收准备），**未部署、未上传、未改云端数据、未进入 A4**。
- 环境：Node v22.23.2 / npm 10.9.8；CloudBase CLI 3.8.4 只读调用；环境 `kangxiaoji-d5gw2k203f0488a9e`。
- 交付：`preflight-report.md`（核验报告）、`dual-phone-acceptance.md`（双手机验收脚本+截图准备）、本摘要、测试输出 4 份。

## 1. 核验结论

1. **云端仍为 A2 版**：$LATEST ModTime 2026-09-22 18:47:36、体积 11,169,553B、Nodejs16.13；快照 v1/v2 在列；A3 云代码未部署。
2. **A3 部署范围**：healthApi 整目录打包 = 修改 3 文件（family-service/record-service/index）+ 共享模块 family-policy/payload-helpers/payload-validation（未跟踪但在包目录内，随包）+ 未改动随包文件；不部署 sendDueReminders；无需新索引/规则。
3. **回滚快照方案（未执行）**：A3 部署前 `publish-version "backup-a3-predeploy-20260923"`（v3，代码同 v2）；回滚 `config-route healthApi 3 100`（或 2）；判别用 familyView 探测响应差异（A2 版无闸口按 self 返回 vs A3 版 denied）。
4. **A7 本地开放在上传范围内**：packOptions 未忽略 pages/family 与 components，当前工作区上传体验版即含家庭 Tab 开放与 coming-soon 删除——是否接受由用户决定（preflight-report §6.1）。
5. **familyView 防绕过**：owner 仅服务端推导；伪造 ownerOpenId 忽略；无绑定/已撤销 denied；read=false 块 scopeDenied + 查询层 allowedTypes；recordDetail 类型闸口；写路由未接 familyView 且按 _openid 归属校验；客户端直调同样受闸口约束。逐项证据见 preflight-report §4。
6. **部署/上传/不改清单**：部署=healthApi；上传=小程序工作区（含 A3 页面与 A7 开放，待决策）；不改=sendDueReminders、索引/规则、运行时。

## 2. 本轮测试（真实退出码）

| 检查 | 退出码 | 结果 |
|---|---|---|
| A3 目标测试 | 0 | 14/14 |
| 全量 Jest | 1 | 552/554；2 失败=settings.test.js 时区对（北京 01:1x 窗口内，既知台账；未改 A3 代码掩盖） |
| npm run regression | 0 | ok |
| npm run lint | 1 | 43（11e/32w）零新增 |

## 3. 双手机验收与截图

`dual-phone-acceptance.md`：P1-P3 准备 + 验收 9 项（每项标注"服务端响应已验证/页面只读状态已验证/仅页面隐藏/尚未验证"层级）+ 截图 F01-F05 与同次网络证据配对要求（截图不能单独证明服务端过滤）。本轮全部待执行。

## 4. 待确认项（部署/上传前，见 preflight-report §6）

1. 体验版是否暴露家庭 Tab（上传即含 A7 本地开放）；
2. A3 部署窗口与回滚责任人；
3. A/B 验收账号与 B 的 openId/网络证据获取方式；
4. 验收数据（邀请/绑定/记录）保留或清理；
5. 家属视图用药趋势分母限制接受或排入 A4/A5。

## 5. 边界

未部署、未上传、未改云端数据、未进入 A4；S01/S06 与第三账号仍缺；settings 时区台账保留。
