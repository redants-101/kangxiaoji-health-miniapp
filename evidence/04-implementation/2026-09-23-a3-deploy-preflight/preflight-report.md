# A3 部署前核验报告（2026-09-23，只读核验，未部署）

- 执行：2026-09-23（01:10–01:30，UTC+8），Zcode；Node v22.23.2 / npm 10.9.8；CloudBase CLI 3.8.4（只读调用）。
- 环境：`kangxiaoji-d5gw2k203f0488a9e`（账号唯一环境）。

## 1. 云端版本核对（只读）

| 项 | 实测 | 结论 |
|---|---|---|
| $LATEST ModTime | 2026-09-22 18:47:36 | 仍为 **A2 部署版**，A3 未部署 |
| 代码体积 | 11,169,553 B | 与 A2 部署记录一致 |
| 运行时 | Nodejs16.13 | 未升级（A-1 独立阶段） |
| 版本快照 | v1 backup-before-a0a1a2-deploy（15:27:16）、v2 backup-a2-deployed-20260922（18:46:47） | 均可用 |

## 2. A3 部署范围清单

**云函数（仅 healthApi，`tcb fn deploy healthApi --force` 整目录打包）**：

| 文件 | 状态 |
|---|---|
| cloudfunctions/healthApi/family-service.js | A3 修改（家属视图闸口 8 方法） |
| cloudfunctions/healthApi/record-service.js | A3 修改（allowedTypes 查询层过滤） |
| cloudfunctions/healthApi/index.js | A3 修改（5 路由 familyView 分支） |
| cloudfunctions/healthApi/family-policy.js | **A3 所需共享模块**（未跟踪新文件，在包目录内，随包部署） |
| cloudfunctions/healthApi/payload-helpers.js | 共享模块（B2 起，随包） |
| cloudfunctions/healthApi/payload-validation.js | 共享模块（B2 起，随包） |
| perf/medication-service/settings-data-service/report-service/daily-stats-service/static-pages + package.json + node_modules | 未改动，随包 |

**不应改动/不部署**：`cloudfunctions/sendDueReminders`（零改动、不部署）；云数据库索引与安全规则（A3 无需新增）；运行时不升级。

**小程序上传范围（若上传体验版）**：当前工作区全部页面代码，含 A3 五页只读态 + home-family 传参 + **A7 本地开放改动**（pages/family/index.wxml 解占位、index.json 去 coming-soon 注册、components/coming-soon 删除、project.config.json packOptions 追加）——packOptions 未忽略 pages/family 与 components，**上传即包含家庭 Tab 开放**（见待确认项 1）。

## 3. A3 回滚快照方案（本轮不执行）

部署 A3 前执行：`tcb fn publish-version healthApi "backup-a3-predeploy-20260923" -e kangxiaoji-d5gw2k203f0488a9e`（将生成 v3，代码等同 v2/A2 版）。
回滚路径：`tcb fn config-route healthApi 3 100`（或 2，二者代码相同）→ 流量回 A2 云代码；页面侧回滚=不上传/回退工作区。判别命令：`tcb fn invoke healthApi --params '{"key":"familyJoin","payload":{},"userInfo":{"openId":"smoke-rollback"}}'` 与 familyView 探测（A2 版对 familyView 参数无闸口、按 self 返回本人数据；A3 版返回 denied noBinding）。

## 4. familyView 闸口防绕过核验

| 攻击面 | 结论 | 证据 |
|---|---|---|
| payload 伪造 ownerOpenId | 忽略：owner 仅由 active 绑定推导 | a3 测试"payload 携带 ownerOpenId 被忽略" |
| 无绑定/已撤销成员开 familyView | denied noBinding / revoked，响应不含 owner 数据 | a3 测试 |
| read=false 块经参数索取（type=bg / metric=medication） | scopeDenied，响应不含该块数据；recordList 另有查询层 allowedTypes 过滤 | a3 测试 |
| 不带 familyView 的普通路由 | 仅返回调用者自身数据（家属自身为空），不泄露 owner | 路由实现 + a3 "owner self" 对照 |
| recordDetail 伪造他人记录 id | familyView 分支按 owner 主体查询 + 类型 read 闸口；非 familyView 按自身主体查不到他人记录 | family-service getFamilyRecordDetailData + 测试 |
| 写路由（代录/删除/计划管理） | 未接 familyView；写路由仍按 _openid 归属校验（assertOwnedDocument）；家属页写入口已隐藏+守卫 | A3 页面改动 + 既有写路由未变 |
| 客户端绕过页面直调 | 服务端闸口独立于页面，直调同样受闸口约束 | 闸口在云函数路由层 |

## 5. 本轮测试（真实退出码）

| 检查 | 退出码 | 结果 |
|---|---|---|
| A3 目标测试 | 0 | 14/14（a3-target.txt） |
| 全量 Jest | 1 | 552 通过/2 失败 = settings.test.js 时区对（执行时北京 01:1x，处于 00:00–08:00 窗口；既知台账，未以改 A3 代码掩盖）（full-test.txt） |
| npm run regression | 0 | ok（regression.txt） |
| npm run lint | 1 | 43（11e/32w），与 A2/A3 基线逐行一致，零新增（lint.txt） |

## 6. 待确认项（部署/上传前）

1. **体验版是否暴露家庭 Tab**：上传当前工作区即含 A7 本地开放。若体验版不开放家庭 Tab：上传前回退 3 处 preflight 改动（pages/family/index.wxml、pages/family/index.json、components/coming-soon 恢复）或接受开放；二选一需用户决定。
2. **部署窗口与回滚责任人**：A3 部署前发 v3 快照；确认回滚执行人与判别命令。
3. **双手机验收账号**：A/B 两台真机微信账号就绪确认；B 的 openId 获取方式（开发者工具云调用日志或接受仅 DevTools 网络证据）。
4. **family_members 当前 0 行**：验收需先产生一条 active 绑定（A 生成邀请→B 加入），该写入属验收必要数据，验收后是否保留/清理需确认。
5. 家属视图用药趋势分母限制（owner 计划未入 familyView home 分支）已知，接受或排入 A4/A5。
