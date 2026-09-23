# A5 数据流审查：撤销实时生效与缓存治理

## 1. 缓存架构现状与 A5 口径

| 层 | 机制 | A5 前行为 | A5 后口径 |
|---|---|---|---|
| services/core.js `cloudReadCache` | key 读接口内存缓存 | 所有 key 一律 60s TTL；失败时**无视 TTL** 回退旧缓存 | owner 本人读：60s TTL + 网络性失败可回退；**家族敏感读：零缓存、每次回源、失败一律上抛**；带 errCode 的服务端显式拒绝对任何键都不回填 |
| `requestCloud`（action） | 写成功后 `clearCloudReadCache()` 全局清 | 保持（fail-safe） | 保持 |
| services/family.js 镜像 `family_auth_v1` | 云端成功后写本地镜像 | 离线回显 + enforceHomeFamilyAccess fail-closed 收窄 | 不变；新增家族事件后 `invalidateFamilyCaches()` 精准失效（A1 的按 memberId 精确增删保持） |
| utils/page-factory.js `pendingPageLoads` | 每页最新加载实例守卫 | loadKey=`path_Date.now()`，**同毫秒双加载键碰撞**，旧请求晚归可覆盖新状态 | loadKey=`path#单调序号`，碰撞消除；旧请求晚归一律不写入 |

## 2. 家族敏感读判定（services/core.js）

`isFamilySensitiveRead(key, payload)`：
- key ∈ FAMILY_SENSITIVE_KEYS（family / familyInvite / familyJoin / familyJoinHint / familyAuth / homeFamily），或
- `payload.familyView` 为真（trend / recordList / recordDetail / medList / medHistory 家属态）。

命中则：不读缓存、不写缓存、catch 中不 stale 回填。→ **每次家属读取都到达服务端**，由服务端按当前 active family_members 行 + 当前 scopes 判定（需求 1/2/3/5 的客户端半边；服务端半边 A3/A4 已实现且每调用重查，A5 服务端零改动）。

## 3. 精准失效（需求 4 清单）

`invalidateFamilyCaches()` = `clearCacheByKeys(FAMILY_PAGE_KEYS)` + `markDirty(FAMILY_PAGE_KEYS)`，
FAMILY_PAGE_KEYS = homeFamily / family / trend / recordList / recordDetail / medList / medHistory（与需求清单一一对应）。

触发点（全部仅在**云端动作成功后**执行；resolveRemote 抛错时不触发）：

| 事件 | 触发处 | 附加行为 |
|---|---|---|
| 撤销成员 | revokeFamilyMemberLocal | 镜像按 memberId 精确移除（撤 M1 保留 M2 卡片） |
| 改权 | updateFamilyAuthLocal | 镜像按 memberId 精确更新 |
| 加入成功（B 端） | joinFamilyByInviteLocal | 镜像置 active |
| 发起邀请 | createFamilyInviteLocal | 镜像置 pending 预览卡 |
| 家属代录/代确认/撤销代确认成功 | 4 个 A4 写包装 `withFamilyInvalidation` | — |
| 成员退出 | 无独立退出动作；退出=注销连带 | 客户端 clearUserAccountLocal 清本人全部存储+云缓存+内存；服务端仅删本人关系行（A1，测试 a1 L463 起覆盖） |

"M1 撤销不清理 M2 的缓存"的落点：服务端 M2 的读取/授权完全不受影响（a5 测试固化）+ 本地镜像只精确移除 M1 卡片。owner 设备上 action 成功后的全局清缓存为现状 fail-safe（超集，不违反精准性——它只多清不少清，且 owner 读键回源代价可接受）。

## 4. 旧请求晚返回守卫（需求 6）

页面 onShow/onLoad 重载 → `loadPageData` 以 `pagePath#seq` 登记最新实例；旧实例返回时键不匹配 → 丢弃写入。a5-page-staleness 用 Date.now 定值制造同毫秒碰撞做确定性回归（旧实现该场景失败，before.txt 在案）。record-list / record-detail 不经 loadPageData（onLoad 直调 API）：单次加载无并发守卫需求，撤销态由下一次进入页面的新请求渲染。

## 5. TTL / 失效 / onShow 明确口径（需求 7）

- 家族敏感读：TTL=0（零缓存），失效=每次请求即最新；
- owner 本人读：TTL=60s（内存，随小程序进程）；网络性失败可回退过期缓存（离线回显），带错误码拒绝不回退；任何 action 成功全局清；
- 页面 onShow：`_loaded` 门槛内一律 `loadData()` 重载并 `markClean`；脏标记（markDirty）供跨页联动与后续按需加载使用；
- 镜像 `family_auth_v1`：无 TTL，仅云端动作成功后写入，只做回显与 fail-closed 收窄。

## 6. 表述边界（需求 8）

本批证明的是：**客户端不再以缓存/镜像作为授权依据，且服务端每次调用按当前关系与 scopes 判定（存储替身级测试）**。"云端撤销实时生效"在真实环境的端到端确认（A 撤销 → B 真机下一次请求被拒）属部署后双手机验证项，本批未验证、不得表述为已证明。
