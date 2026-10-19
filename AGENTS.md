# AGENTS.md

给接手这个仓库的代理 / 维护者读的交接面。使用者文档在 `README.md`，发布流程在
[`docs/RELEASING.md`](docs/RELEASING.md)，签名与协作分工在
[`docs/contributor-ci-signing.md`](docs/contributor-ci-signing.md)。

## 这个仓库是什么

`dsh-our-free-model` 是挂进 DeepSeek Harness（DSH）内核的插件：免费车道 + 十三个
账号渠道 + 桌面端的 EAC 协付车道。两种落地形态共用一份运行时：

- **DSH 插件**：`index.js`（服务端）/ `client.js`（Web GUI 端）/ `src/`（运行时）；
- **独立产品**：`packages/standalone/`（`cli.mjs` 起本地网关）。

`src/` 是真正的运行时；`scripts/` 是离线测试与发布工具，不进安装包
（`src/updater.js` 的 `REPOSITORY_SCAFFOLDING` 会跳过它们）。

## 怎么跑

```bash
node scripts/test-all.mjs                 # 默认：全部套件（发布前必须全绿）
node scripts/test-all.mjs --mode contributor   # 只跑代码检查（贡献者）
node scripts/test-all.mjs --mode release       # 发布门：manifest + release + catalog + vault + updater
node scripts/test-all.mjs --only vault         # 单个套件
node scripts/build-manifest.mjs --check        # 清单与实物是否一致
```

本机（Windows）跑套件的已知环境性失败，与代码无关：`reload`、`channel-source`、
`gateway-source` 缺 devDependency（`@deepseek-ai/cordis`、`typescript`），
`opencode-parity` 撞本机 Node 的 ESM loader API。

## 硬性约束（改动前先读）

### 1. 桌面宿主闸门不要按 profile 名建模（#267）

EAC 协付车道只在「宿主是受支持的桌面 / Web 外壳」时打开。判断宿主身份的唯一可靠信号
是外壳自己打上的东西，**不是 profile 名**：DSH Tauri 桌面端用用户实际在用的档案启动
内核（本机是 `--profile core-021`），任何 profile 名字面量都覆盖不到真实安装。

- 信号常量：`src/vault.js` 的 `TAURI_EMBEDDED_ENV`（`DSH_TAURI_EMBEDDED=1`）；
- 外壳侧同源：`dsh-tauri` 自己的桌面 carrier 适配器读同一个变量；
- 桌面宿主不能出字时先查这里，再查网络。

### 2. 闸门是代码，所以「升级」可能把它弄丢

发布是整包替换运行时文件（`src/updater.js` 的 `installStaged`）。一个在闸门修好之前
切出来的发行版会把闸门覆盖回旧版本，用户只会看到 roster 里少了 EAC。两道防线：

- `src/updater.js` 的 `stagedReleaseKnowsDesktopHost` + `apply()`：在**暂存校验通过、
  安装前**拒收「不认 `DSH_TAURI_EMBEDDED`」的发行版（文本扫描，不 import 下载内容）；
- `scripts/test-all.mjs` 的 `releaseSuites` 含 `vault` 与 `updater`：闸门或这道守卫
  退化时，发布门直接红。

### 3. 改发布文件必须重签清单

`feed/manifest.json` 是发布者对每个文件字节数与 SHA-256 的承诺。改了 `index.js` /
`client.js` / `src/**` 却没重跑 `node scripts/build-manifest.mjs --key <私钥>`，
这一版的一键升级对所有旧版本用户都会失败。`build-manifest.mjs --check` 会先失败，
它在 `npm test` 与发布门里都有位置。**私钥不在仓库里，也不在代理手里**：需要签名时
交回仓库主人。

### 4. 测试不要依赖调用者终端

套件可能被从 DSH Tauri 会话里启动，从而继承 `DSH_TAURI_EMBEDDED=1`。断言「某宿主
必须被闸门拒绝」的套件必须自己决定环境：经 `scripts/lib/fake-kernel.mjs` 启动的
会自动清理该变量，其余由 `test-all.mjs` 在子进程 `env` 里删除。
