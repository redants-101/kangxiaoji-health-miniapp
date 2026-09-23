# B1 回归脚本中断修复 · 记录（summary）

- 批次：实施批次 1 / B1（回归脚本中断修复）
- 日期：2026-09-22
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`（最新提交 2026-08-10 "code update"）
- 范围声明：本轮**只修改测试脚本** `scripts/health-api-regression.js`；未改任何业务实现、测试断言标准（仅对齐已演进的数据结构）、依赖、运行时、云端配置；未提交、未推送、未部署、未切分支、未清理未跟踪文件。

## 1. 执行环境（已重新核实）

| 项 | 值 |
|---|---|
| node 路径 | `C:\Users\123\AppData\Local\DoubaoWork\User Data\sandbox_runtime\bases\c98c5042338ed152c6f10ecd8591889f\node\node.exe`（`process.execPath` 实测） |
| node 版本 | v22.23.2 |
| npm 版本 | 10.9.8（经同目录 node 运行 npm-cli，保证 npm 及其子进程使用同一套 Node） |
| 检查命令 | `npm run regression` → `node scripts/health-api-regression.js`（package.json scripts） |
| 脚本性质 | 纯本地 Mock：脚本内置 MockDb/MockCollectionQuery，不连接云环境、不发网络请求 |

## 2. 命令与退出码

| 轮次 | 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|---|
| 修复前 | `npm run regression` | **1** | testMedicationService 在 L295 抛 TypeError，后续 testFamilyService / testSettingsDataService **整段未执行** | `before.txt` |
| 修复后 | `npm run regression` | **0** | 打印 `health-api-regression: ok`，四组用例全部走完并通过 | `after.txt` |

修复前报错原文：`TypeError: Cannot read properties of undefined (reading '0') at testMedicationService (.../scripts/health-api-regression.js:295:36)`，与 2026-09-21 基线、2026-08-11 历史基线现象一致。

## 3. 根因（两处，均为脚本/夹具落后于业务实现，非业务缺陷）

### 3.1 用药列表返回结构已由扁平 `todayLogs` 演进为 `todayCards + confirmations`
- 业务实现 `cloudfunctions/healthApi/medication-service.js`：
  - `getMedListData` 现在返回 `{ eyebrow, todayCards, plans, confirmations }`（L155-L160），全文件无 `todayLogs`；
  - `todayCards` 按计划分组，卡片内 `logs[]` 元素含 `statusText`（L127-L137、L90-L98）；已确认流水另在扁平 `confirmations[]`（L140-L153）；
  - 今日确认记录按 `confirmDate = getTodayDateValue()`（北京时间当天）查询（L50-L55）；新写入的确认记录必带 `confirmDate`（confirmMedication L427）。
- 脚本旧断言 `list.todayLogs[0].statusText`（修复前 L295）访问已不存在的字段 → undefined[0] 崩溃。
- 同时夹具 `confirm-1` 缺少 `confirmDate`：即使字段名改对，按当天查询的语义该记录也会被过滤（Mock 的 where 为严格相等匹配，脚本 L150-L157），无法再验证"已服"渲染——夹具同样落后于现实现。

### 3.2 家属首页用药计划查询新增 `status: '启用'` 过滤，夹具计划缺少 status
- 业务实现 `cloudfunctions/healthApi/family-service.js` getHomeFamilyData 查计划时 `where({ _openid: ownerOpenId, status: '启用' })`（L100-L105），`medicineLogs` 由查询到的 plans 生成（L138-L150、L167）。
- 脚本家属用例夹具 `plan-family` 无 `status` 字段（修复前 L336-L345），严格匹配下 plans 为空 → `medicineLogs[0]` 为 undefined → 旧断言 `homeFamily.medicineLogs[0].name`（修复后 L443）抛 `Cannot read properties of undefined (reading 'name')`。
- 真实文档由 saveMedicationPlan 写入时恒带 `status: '启用'`（medication-service.js L354），故属夹具缺字段，不是业务问题。

## 4. 实际修改（完整 diff 见 `fix.patch`，仅 1 个文件）

`scripts/health-api-regression.js` 三处：

1. 新增本地辅助 `getTodayDateValue()`（与 medication-service L8-L18 同一北京时间口径），供夹具生成当天 `confirmDate`。
2. 用药夹具 `confirm-1` 增加 `confirmDate: getTodayDateValue()`（对齐现在按天查询的契约；保留旧 logId `log-plan-1-0`，继续覆盖服务端 L87-L88 的旧 logId 兼容分支）。
3. 旧断言 `list.todayLogs[0].statusText === '已服'` 替换为对现结构的等价断言：
   - `Array.isArray(list.todayCards)`；
   - `list.todayCards[0].logs[0].statusText === '已服'`（07:00 槽位经旧 logId 命中已服确认，21:00 待确认，卡片仍保留）；
   - `list.confirmations[0].statusText === '已服'`（扁平已确认流水，原断言意图的直接继承者）；
   - `list.plans[0].schedule === '每天 07:00, 21:00'` 保持不变。
4. 家属夹具 `plan-family` 补 `status: '启用'`（对齐 L101 查询契约）。

未删除任何用例、未跳过断言、未用空数组兜底、未 try/catch 吞错、未把业务实现改回旧结构。

## 5. 修复后各组用例真实执行证据

脚本 main 顺序 await 四组函数，任一抛错即不会打印 ok。为逐段取证，另在**系统临时目录**生成过一次性插桩副本（仓库内不留文件，运行后已删除），仅加 STAGE-START/PASS 日志，输出：

```
STAGE-START perf
STAGE-PASS perf
STAGE-START medication
STAGE-PASS medication
STAGE-START family
STAGE-PASS family
STAGE-START settings
STAGE-PASS settings
health-api-regression: ok
EXITCODE=0
```

即 testPerfSchema、testMedicationService、testFamilyService（含 createFamilyInvite / joinFamilyByInvite / getHomeFamilyData 断言）、testSettingsDataService（提醒/隐私/反馈/数据管理/导出/删除/注销断言）**本轮均真实执行且全部通过**；基线中"用药用例提前退出、后两组整段未执行"的中断已消除。

## 6. 仍未通过 / 未验证项

- `npm test`（Jest，基线 2 个失败：page-data-consistency trend 断言）与 `npm run lint`（基线 12 error/34 warning）本轮**未重跑、未处理**——分属 B4/B2，不在 B1 范围。
- 本回归是**本地 Mock 验证**：不连真实云数据库、不验证云函数 _openid 归属、安全规则、索引、频控与真实邀请链路；**本地回归通过不等于真实云环境验证通过**。
- B1 只让脚本对齐现状结构，未补任何新场景覆盖（三级权限、代录、撤销、1:1 等属后续 A 批次测试任务）。
- 业务代码零改动；工作区跟踪文件仅 `scripts/health-api-regression.js` 一个被修改，未跟踪项仍为既有的 `docs/家庭Tab开放与三级权限只读分析.md` 与 `evidence/`。
