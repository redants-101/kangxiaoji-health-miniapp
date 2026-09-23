# 联调前核验与部署准备 · 摘要

- 日期：2026-09-22（16:50–17:30，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`；分支 `feat/family-permission` @ `a751776`
- 环境：Node v22.23.2 / npm 10.9.8（本地检查）；CloudBase CLI 3.8.4（npx 临时运行 + 干净 npmrc 绕过失效代理，未改用户 ~/.npmrc）
- 本轮云端操作**全部只读**（fn detail/versions/get-route、db listIndexes/count、DescribeDatabaseACL、env list）；未部署、未改云端数据/索引/规则/流量、未上传体验版。既有改动全部保留。

## 1. 交付物索引（本目录）

| 文件 | 内容 |
|---|---|
| `env-comparison.md` | 云端与本地版本对照：唯一环境、$LATEST=15:28 A2 版、路由 100% $LATEST、回滚版本 1 可用、索引/ACL/数据量实测 |
| `sdk-contract-check.md` | SDK 契约三项核对结论 + add-catch 缺陷的失败测试与最小修正记录 |
| `deploy-scope.md` | 部署文件范围（含 3 个未跟踪共享模块的打包警示）、前后端兼容矩阵、部署命令 |
| `rollback-steps.md` | 方案 A（切版本 1，整体回退）/ 方案 B（先建 A2 版快照再回退收尾改动，推荐）+ 回滚生效判别 |
| `user-confirmations.md` | 5 项待用户确认（环境定位/部署范围/历史数据/前端上传/git 入库时机） |
| `verification-plan.md` | 部署后四类验证（CLI 冒烟/真实账号/并发/异常），写入型均注明环境、数据范围、预期、清理 |
| `screenshot-manual.md` | S01–S08 逐步手册（账号/路径参数/操作/预期文案/文件名/前置与失败处理） |
| `before-fix.txt` / `followup-after-fix.txt` / `full-test.txt` / `regression.txt` / `lint.txt` | 本轮测试输出 |
| `fix.patch` | 本轮独立补丁（2 段：family-service.js add-catch 修正 + a2-followup 新增基础设施异常测试），基线=A2 收尾态，已验证干净应用且逐字一致 |

## 2. SDK 契约核对结论（对照实际部署的 wx-server-sdk 2.6.3 源码）

1. **where().update() 返回 `{stats:{updated}}`**：内层 @cloudbase/database 返回 `{updated}`（query.js L172），外层 wx-server-sdk Query 包装重包为 `{stats:{updated}}`（index.js L1500-L1523）——业务代码读 `res.stats.updated` **正确，未改代码**；方案文档与代码的出入属封装层差异，已在 sdk-contract-check.md 澄清。
2. **事务 doc.get**：throwOnNotFound 配置经 `cloud.database(config)` → `Database.config` → DocumentReference 生效（L1272/L1015-L1030）；不存在 → `{data:null}`，事务态 data 为对象非数组（L1276 注释）；基础设施异常直接 reject。index.js 配置与业务判空写法均与之匹配。
3. **add 自定义 _id 重复**：SDK 两层均无重复键专属错误码（错误码表仅 -502001~-502005），预期为服务端透传的 Mongo `E11000 duplicate key` 报文——**真实报文属云端待验证**（verification-plan §4.1 有实测步骤）。

## 3. 确认并修复的缺陷（先失败测试后最小修正）

`reserveFailureSlot` 的 add catch 原先把任何异常当重复键冲突，重试耗尽后返回 null → **网络/权限等基础设施异常会伪装成 RATE_LIMITED 频控拒绝**。修复：仅报文匹配 `/E11000|duplicate key/i` 才按冲突重试，其余原样上抛；签名不匹配时行为退化为上抛（fail-closed，不放宽）。新增测试"add 发生非重复键的基础设施异常：原样上抛"修复前实测失败（before-fix.txt），修复后通过。未做无关重构。

## 4. 复跑结果（真实退出码）

| 检查 | 退出码 | 结果 |
|---|---|---|
| a2-followup（含新测试） | 0 | **23/23** |
| 全量 Jest | 0 | **528/528，22 套件全过** |
| npm run regression | 0 | ok（B1 四组真实执行） |
| npm run lint | 1 | 11 error/32 warning，**零新增**（范围 services/utils/pages/components；cloudfunctions 不在内） |

settings 时区台账保留（本轮下午执行全绿，未等待时段）。

## 5. 截图手册修正落实（任务四处要求）

- S05 仅接受 REVOKED，出现 USED 明确为"不算通过、回来调查"；
- S03 拆分为 S03a（格式非法）与 S03b（格式正确不存在），分别归档；
- S07 标注**最后拍**并说明会锁死当日额度；
- S08（无邀请码说明态）纳入必拍；
- 上传体验版不再是统一前提：按"开发者工具本地编译（无需上传）/真机体验版（需上传）"两种方式分别说明；
- 明确禁止手工改页面状态伪造验收图，夹具触发的图（S04）必须标注来源与改动内容。

## 6. 部署方案（供用户确认，本轮未执行）

1. **前置确认**：user-confirmations.md §1（唯一环境是否承载已发布小程序）、§2（仅部署 healthApi + 先建快照）。
2. 建回滚快照：`tcb fn publish-version healthApi "backup-a2-deployed-20260922" -e kangxiaoji-d5gw2k203f0488a9e`。
3. 部署：`tcb fn deploy healthApi --force -e kangxiaoji-d5gw2k203f0488a9e`（按磁盘目录打包，自动包含 3 个未跟踪共享模块；**不得**在 git 入库前改用 CI/他机部署）。
4. 冒烟判别：CLI invoke 缺码 familyJoin 应返回 `noInvite:true`（收尾版特征）；再跑 verification-plan §1.2-1.4 并清理 smoke 数据。
5. 异常回滚：方案 B 切快照版本（命令见 rollback-steps.md）。
6. 前端体验版上传与 S01–S08 截图：待部署冒烟通过后按手册执行（本轮不上传、不截图）。

## 7. 边界

未进入 A3；未执行 verification-plan 中任何写入型验证；未部署；未上传；未提交 git；未清理既有文件。累计未提交改动与 A2 收尾时一致（18 个跟踪修改 + 未跟踪代码文件，本轮 a2-followup.test.js 增 1 个用例、family-service.js 增 1 处判别，均在既有文件内）。
