# EAC 宿主闸门在 DSH Tauri 桌面端不认可宿主（#267）验收

日期：2026-10-19。基线：本地 main `f0b979f`（2.5.3 已发布版本）。
未推送、未改版本号、未重签发布清单——重签需要仓库主人手里的发布私钥，见文末。

> 本文最初写于 `src/vault.js` 的改动**还没落到树上**的那一版：文档、测试脚本、
> 清单说明都在，唯独闸门本体没有，套件因此有两条红。2026-10-19 复跑时补上了本体，
> 并把「升级会把闸门覆盖回旧版本」这条复发路径一并堵上（见「二次防护」）。

## 症状与根因

设置页显示「EAC 协付模型在当前运行环境不可用：宿主未提供可识别的桌面 / Web 配置，因此不加载该渠道」，模型选择器里没有 EAC 分组。

根因不在 web / 桌面判断本身，而在**宿主身份被建模错了**。
`src/vault.js:73` 的 `detectSealedHost` 只认两类信号：

1. DSHEAC AIO 的三重信号（`DSH_HOME` 含 `com.deepseek.dsh.desktop.aio` + `resources\node\node.exe` + argv 含 `web-desktop`）；
2. 内核 `profileContext.name` 等于字面量 `web` / `web-desktop` / `desktop` / `tauri`。

而真实 DSH Tauri 桌面端**不固定 profile 名**——它用用户实际在用的档案启动内核。本机实测命令行（`Get-CimInstance Win32_Process`）：

```
D:\Tools\nodejs\node.exe --max-old-space-size=16087 ... \
  C:\Users\84561\AppData\Roaming\dsh-tauri\dependencies\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js \
  --profile core-021 --patch C:\Users\84561\AppData\Roaming\dsh-tauri\cordis.hmr.patch.yml --port 3080 --no-open
```

`core-021` 既不是 `tauri` 也不是 `desktop`，于是闸门返回 `null`。任何 profile 名规则都覆盖不到这个宿主：档案名是用户自己起的，外壳不会为了配合闸门改名。

外壳真正稳定、且不是用户可改参数的身份信号，是它打在进程环境里的标记：

```
D:\Software\DSH Tauri\resources\node_modules\dsh-tauri\dist\index.js:24   const EMBEDDED_ENV = "DSH_TAURI_EMBEDDED";
D:\Software\DSH Tauri\resources\node_modules\dsh-tauri\dist\index.js:26   if (process.env[EMBEDDED_ENV] !== "1") return noop;
D:\Software\DSH Tauri\resources\node_modules\dsh-tauri\dist\index.js:91   if (process.env.DSH_TAURI_EMBEDDED === "1") ctx.effect(() => ctx.on("webserver/index-inject", ...
```

这是 `dsh-tauri` 自己用来判断「我在 DSH Tauri 里运行」的同一标记；外壳必须自己把内核拉起来，进程才会带上它。

同一根因也解释了此前那轮 2.5.3 排查为何看着通过：当时的回归用 `profileName: 'tauri'` 断言闸门放行（`scripts/vault-test.mjs` 的「the kernel-provided DSH Tauri profile is a desktop host」），而本机从来不会报出这个名字。**测试测的是一个不存在的宿主。**

## 改动

| 文件 | 改动 |
| --- | --- |
| `src/vault.js` | 新增 `TAURI_EMBEDDED_ENV = 'DSH_TAURI_EMBEDDED'`；`detectSealedHost` 在 profile 名规则**之前**加 `env?.[TAURI_EMBEDDED_ENV] === '1' → FLAVOR_HARNESS`（profile 名规则一条不动） |
| `scripts/lib/fake-kernel.mjs` | 与既有的 base URL 兜底并列，删除继承来的 `DSH_TAURI_EMBEDDED`：凡经该脚手架启动插件离线套件（20 个）都自动免疫调用者终端 |
| `scripts/vault-test.mjs` | 新增 3 条闸门断言 + 1 个启动块（标记宿主下列出密封模型、`laneAvailable` 为真、`/pool` 可用）；`bootWith` 支持 `shellMarker` 并在 `restore()` 中清理。原先本文件里的标记清理改由上面的共享脚手架承担 |
| `scripts/test-all.mjs` | 子进程 `env` 中删除 `DSH_TAURI_EMBEDDED`，覆盖不经过脚手架的那 16 个套件 |
| `src/updater.js` | 新增 `stagedReleaseKnowsDesktopHost`；`apply()` 在 `verifyStaged` 之后、`backupPackage` / `installStaged` 之前拒收「暂存发行版里没有任何脚本认 `DSH_TAURI_EMBEDDED`」的升级（仅当本进程带桌面标记） |
| `scripts/updater-test.mjs` | 新增 2 条断言：带标记的宿主上，不认标记的发行版被拒且已装副本一字未动；同一份升级在发行版带标记时正常装完 |
| `scripts/test-all.mjs` | `releaseSuites` 增加 `vault`、`updater`：发布门从此覆盖闸门本体与这道升级守卫 |
| `README.md` / `README_EN.md` | 宿主识别清单补上该标记及其原因 |
| `AGENTS.md`（新增） | 把「桌面宿主不按 profile 名建模」「升级可能弄丢闸门」「改发布文件必须重签清单」写成硬约束，供后续会话直接照做 |
| `docs/verification/2026-10-17-issue-audit.md` | #267 行由「上游或环境阻断」改判「本次修复」，加更正说明，审计计数相应变动 |

闸门强度没有放宽：命令行参数单独出现依旧不通过（`--profile tauri` 无 `profileContext` 时仍为 `null`，既有断言保留），只有外壳实际拉起内核才会带的标记才放行。

测试基建这一并修不是顺手扩大范围：闸门新增了一条环境变量信号，就必须让「断言闸门拒绝某宿主」的套件自己决定环境，否则在 Tauri 会话里直接跑套件会把调用者的终端当成被测宿主——本次就是这么发现 `forward-boot` 的假失败的。

## 二次防护：让修复不会在插件更新后消失（2026-10-19 补）

闸门是**代码**，而插件的一键升级是整包替换运行时文件（`src/updater.js` 的
`installStaged`）。也就是说：修好之后，只要装回一个在修复之前切出来的发行版，闸门就
会退回旧版本，用户看到的仍是那句「宿主未提供可识别的桌面 / Web 配置」。这条复发路径
与网络、配置都无关，新建两道防线：

1. **升级时拒收会弄丢闸门的发行版**（`src/updater.js`）。`apply()` 在暂存目录通过
   `verifyStaged`（字节数与 SHA-256 全对）之后、`backupPackage` / `installStaged` 之前，
   若本进程带桌面标记（`DSH_TAURI_EMBEDDED=1`）而这份暂存发行版里**没有任何随包脚本
   出现该标记**，直接抛错、已装副本一字未动：
   `release X does not recognise DSH_TAURI_EMBEDDED and would disable the co-paid lane on this DSH Tauri desktop; install a release that carries the desktop host gate`。
   判定用文本扫描（`stagedReleaseKnowsDesktopHost`），**不 import 下载内容**——升级校验
   链里不允许先执行后验证。
2. **发布门必须覆盖闸门**（`scripts/test-all.mjs`）。`releaseSuites` 从
   `manifest/release/catalog` 扩到含 `vault`、`updater`：闸门本体或上面这道守卫退化时，
   `node scripts/test-all.mjs --mode release` 直接红，发布前就看得见。

两道防线都只解决「已发布的发行版把闸门弄丢」；它们不解决「本地改的运行时被升级覆盖」
——本机插件目录是指向开发仓库的 junction，升级会在那里写入发行版文件。守卫对这台机器
同样生效（它的内核带桌面标记），所以旧发行版装不下来。

## 验证

本机实测（`D:\Users\Documents\Object\OurFreeModel\probe-gate.mjs`，用真实内核信号喂 `src/vault.js`）：

| 信号 | 修复前 | 修复后 |
| --- | --- | --- |
| `detectSealedHost({env(真实), execPath(真实), argv(真实), profileName:'core-021'})` | `null` | `harness` |
| `unlockSealedLane({ profileName: 'core-021' })` | `false` | `true` |

| 检查 | 结果 |
| --- | --- |
| `node scripts/vault-test.mjs`（标记随会话继承） | `all checks passed`，退出码 0；含 4 条新断言 |
| 同上，仅把 `src/vault.js` 的改动 stash 掉 | 2 条新闸门断言失败（其余通过）——新测试确实咬住这次改动 |
| `node scripts/forward-boot-test.mjs`（标记随会话继承） | 14 项全 `ok`；修 `fake-kernel.mjs` 之前，同一命令报 `FAIL and serves a roster to its own key — got [200,8], want [200,1]` |
| `node scripts/updater-test.mjs` | `updater-test: OK`；新增的 2 条守卫断言在前述「先 stash 闸门再跑」时同样红 |
| `node scripts/build-manifest.mjs --check` | **失败（预期）**：磁盘上的 `src/vault.js`/`src/updater.js`/`client.js`/`package.json` 与本机 `feed/manifest.json` 的哈希不一致——发布前必须用发布私钥重签，见文末 |
| `node scripts/test-all.mjs --mode contributor` | 67/71 套件通过；`vault`、`forward-boot` 均通过。其余 FAIL 见下 |
| `node scripts/test-all.mjs`（全量，复跑） | 66/73 套件通过；FAIL：`manifest`、`release`、`catalog`（发布清单未重签 + `README.md` 在工作树里被 WIP 删掉，见下）、`reload`、`channel-source`、`gateway-source`、`opencode-parity`（本机环境） |
| 运行中的插件自身 API `GET /api/our-free-model/summary` | `laneAvailable: true`（修复前同一接口返回 `false`），`channel: "eac"` 行 8 条，全部 `availability: "available"`；`catalog` 35 行 |
| 同一实例 `GET /api/our-free-model/pool` | `ok: true`（修复前随车道一起关闭） |

最后一项的复现命令（插件在跑时）：

```powershell
Invoke-RestMethod http://127.0.0.1:3080/api/our-free-model/summary
```

返回里的 `laneAvailable` 与 `catalog` 中 `channel -eq 'eac'` 的行数就是上面两个数。

**仍失败的套件（与本次改动无关，stash 前后同样失败）**：

| 套件 | 失败原因 |
| --- | --- |
| `reload` | `Cannot find package '@deepseek-ai/cordis'`——本地 `node_modules` 未安装该 devDependency |
| `channel-source` / `gateway-source` | `Cannot find package 'typescript'`——同上 |
| `opencode-parity` | `TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.mode' must be one of: 'strip'. Received 'transform'`——本机 Node 26.11.1 的 ESM loader API 与套件用法不符 |

已用 `git stash push -- src/vault.js scripts/vault-test.mjs scripts/test-all.mjs` 复原基线复跑确认：这四项在未改动的树上同样失败。本次没有修它们，也没有声称它们通过。

**发布相关三项失败，是「还没重签清单 + 工作树里的 2.5.5 WIP」的必然结果，不是本次改动引入的**：

| 套件 | 失败原因 |
| --- | --- |
| `manifest` | `build-manifest.mjs --check`：`feed/manifest.json` 仍是 2.5.3 的签名快照，磁盘已是 2.5.5。漂移文件里 `client.js`、`package.json`、`src/sponsor.css`、`src/sponsor.js` 在本次改动之前就在工作树里；本次又多出 `src/vault.js`、`src/updater.js` |
| `release` | 同上（`the manifest describes the tree it lives in — drifted`），并且 `src/sponsor.*` 未被清单收录 |
| `catalog` | `version tracks package.json — got "2.5.3", want "2.5.5"`，以及 `ENOENT ... README.md`（WIP 把 README 删了，catalog 套件要读它的 tarball 版本号） |

也就是说：这一版必须由仓库主人用发布私钥重签清单、把 `README.md` / `README_EN.md` 的版本号补上，才能通过发布门。代理没有私钥，也不该伪造签名。

## 未验证

- 没有重启 DSH Tauri 桌面端。上述端到端结果是插件自身的文件监听热重载之后、经它自己那套设置接口读到的（`settings.autoReloadWatch: true`、`reloadCount: 12`）；**冷启动路径未复测**，不过冷启动走的闸门与热重载是同一段 `detectSealedHost`。
- 设置页的渲染没有复测：读的是接口返回的 `catalog`，不是浏览器里看到的模型选择器。`laneAvailable` 与 8 条 `channel: "eac"` 都源自接口，渲染是下一步。
- 没有出网验证真实 EAC 模型能否出字。`availability: "available"` 是这一轮探测的结论（`probedAt` 见各行），不代表上游此刻一定答得出来。
- 没有推送、没有发布、没有改版本号、没有重签 `feed/manifest.json`（私钥不在本机代理手里）。**要让修复随更新继续存在，必须由仓库主人重签并发布一版**——否则用户装回旧发行版时，只有本机这道升级守卫拦着。

## 一个仍存在的风险（已缓解，未消除）

本机插件的安装目录是指向开发仓库的 junction（`C:\Users\84561\.dsh\profiles\core-021\node_modules\dsh-our-free-model` → `D:\Users\Documents\Object\新增插件\dsh-our-free-model`）。一键升级若在这条路径上跑，会按发行版文件整包覆盖运行时——本地改动（含这次闸门）就没了。升级守卫能拦住「不认标记的发行版」，但拦不住「认标记、却和本地开发版不同步」的发行版覆盖。要让本地开发版免于被覆盖，得把 junction 换成实体安装或改用独立 profile；这属于本机部署选择，不在本次改动范围内。
