# A0-2 收尾修正 · 邀请入口不得默认放权 · 摘要

- 日期：2026-09-22（12:54–13:20，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 环境：Node v22.23.2 / npm 10.9.8；全部既有改动保留；未切分支、未提交、未清理、未部署、未升级运行时、未开放家庭 Tab。

## 1. 根因

`normalizeFamilyInvitePayloadV2` 的 scopes 处理是：

```js
Array.isArray(payload.scopes) && payload.scopes.length
  ? normalizeFamilyScopesV2(payload.scopes)
  : getDefaultInviteScopesV2()
```

凡不是"非空数组"的输入（缺失、[]、null、字符串、对象）全部回退到**四块 read/remind=true** 的邀请预选值。预选值本应用于页面初始展示，却被当成服务端缺失输入的授权兜底——空输入直接获得完整查看权。复现输出见 `repro.txt`（5 种输入全部 read=true,true,true,true）。

## 2. 修正内容（最小，5 个文件）

**云端 family-policy.js**：

- `normalizeFamilyInvitePayloadV2`：scopes 非数组（缺失/null/字符串/对象）→ 抛"授权范围格式不正确"；空数组合法，经 `normalizeFamilyScopesV2` 四块全 false；显式合法 scopes 按原样归一化，未提交块与缺失布尔字段为 false。未新增任何自动开启 read/remind 的分支。

**同链路同类兜底（只修同类）**：

- `services/family.js` 的本地镜像 `createFamilyInviteLocal`：非数组输入由 `getDefaultInviteScopes()` 兜底改为最小授权镜像（`SCOPE_KEYS.map(key=>({key}))`）。正常时序下云端先拒绝、镜像不执行，此修正确保镜像路径也不含放权分支。
- 授权保存入口 `normalizeFamilyAuthPayloadV2` 经核查**本就正确**：非数组回落 `SCOPE_KEYS_V2.map(key=>({key}))`，归一化后全 false，未改动。
- 页面提交 `createInvite` 始终提交当前 `data.scopes` 数组，无服务端兜底问题，未改动。

**测试与回归**：

- `tests/unit/a0-contract-integration.test.js`：旧用例"空入参默认放权"已替换/保留场景重构为 8 个用例（非法四类拒绝且零写入、[] 全关、部分提交不补开、显式合法完整保存，及既有非法布尔/未知/重复/report.write 覆盖）；场景未删除。
- `tests/unit/shared-policy.test.js`：模块级旧预期同步修正。
- `scripts/health-api-regression.js`：family 用例的 `createFamilyInvite('owner-1', {})` 改为显式提交四块 read 授权，断言内容不变。

## 3. 页面初始全开：记录为待确认，不解释为已授权

familyInvite 展示接口与邀请页加载时仍给出 read/remind 预选勾选（`getDefaultInviteScopesV2`）。这是 **UI 预选值**，用户可逐块修改；目前没有已确认决策对"初始是否应全开"单独拍板，登记为待确认。它的效力边界：仅用于展示与提交前编辑，服务端缺失/非法输入不再据此放行；提交后以服务端归一化结果为唯一授权依据。

## 4. 测试结果（真实退出码）

| # | 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|---|
| 修复前 | 目标测试（新增/修正用例） | 1 | **5 失败 / 13 通过**（18 总） | `before.txt` |
| 修复后 | `npm test -- --runInBand tests/unit/a0-contract-integration.test.js` | **0** | **18/18** | `after.txt` |
| B1 护栏 | `npm run regression` | **0** | `health-api-regression: ok`，四组真实执行 | `regression.txt` |
| 全量 | `npm test -- --runInBand` | **0** | **452/452，19 套件全过**（446 + 净增 6） | `full-test.txt` |
| Lint | `npm run lint` | 1 | 11 error/33 warning（与 A0-2 后相同） | `lint.txt` |

## 5. 对 A0-2 报告两处表述的修订

1. **canPerformScopeAction**：它的规则单测（A0-1/A0-2）通过，只证明规则函数本身正确；**真实代录/代确认写接口尚未接入该鉴权**，目前没有任何写路径调用它，不能据此声称写接口已鉴权。
2. **"lint 无新增"的范围**：该结论仅适用于 `npm run lint` 的实际检查目标（services/ utils/ pages/ components/）；**cloudfunctions 当前不在该 lint 范围内**，云端目录的 lint 状态没有被该检查覆盖（属 B6，未实施）。

## 6. settings 时区台账（独立限制）

本轮北京下午执行，全量全绿。settings.test.js 在北京 00:00–08:00 仍会因 UTC/北京日期错配失败 2 个；未修、未等时段。

## 7. 本地与云端边界 / 未执行项

- 全部为本地 Jest、存储替身与 Mock 回归：不连真实云数据库；三级文档真实读写、_openid 归属、安全规则、邀请真实链路、撤销实时性未验证；本地 452 全绿不等于云端通过。
- A1（1:1、family_auth 修复、注销连带）、频控、contactPhone/拨号、代录写路径、二级页权限、Tab 开放、Node18、全仓 Lint/日期去重、云端操作与部署——均未进行。

## 8. 累计未提交改动

已跟踪修改 **14 个**（与 A0-2 后同一文件集合，本轮为其中 5 个文件的内容修正）；新增未跟踪 **6 个**（payload-helpers.js、payload-validation.js、family-policy.js、shared-policy.test.js、a0-permission-policy.test.js、a0-contract-integration.test.js）；另含既有 docs 文档与 evidence/。

## 9. 证据索引

- 本目录：`repro.txt`、`before.txt`、`after.txt`、`regression.txt`、`full-test.txt`、`lint.txt`、`fix.patch`、本摘要；
- `fix.patch` 以 A0-2 完成态（临时树重放全部历史补丁）为基准，5 段；已验证干净应用、应用结果逐字一致，不含历史批次内容；
- 关联的原始 A0-2 证据保留在 `2026-09-22-a0-contract-integration/`，其中 `summary.md` 已附修正说明指针。
