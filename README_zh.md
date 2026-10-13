# ⚡Bolt

[English](README.md) | 简体中文

> _本文由 AI 翻译，可能存在不准确之处，将在后续版本中人工校正。_

自动化你的虚幻引擎日常工作流程。

Bolt 是一个 CLI 工具，将重复的 UE 任务——更新源代码控制、重新构建编辑器、启动游戏、填充 DDC——转化为可以链式调用、脚本化和与团队共享的单行命令。

```
bolt run update build start
```

不再手动运行 Build.bat。不再在 TortoiseSVN、编辑器和一堆批处理脚本之间来回切换。在 `bolt.yaml` 中定义一次工作流程，随处运行。

## 安装

**Windows**

```powershell
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

`bolt.exe` 安装到 `%USERPROFILE%\.bolt\bin`，并把该目录加入用户 Path。如果 PATH 上已有 `bolt.exe`，脚本会原地更新那一份。

**macOS 与 Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | sh
```

Intel macOS 安装 `bolt-mac-x64`。Apple Silicon 安装 `bolt-mac-arm64`。Linux x64 安装 `bolt-linux-x64`。二进制位于 `~/.bolt/bin/bolt`。如果 PATH 上已有 `bolt`，脚本会原地更新那一份。脚本安装的更新方式：

```
bolt self-update
```

## 快速开始

安装后，在你的项目中生成配置：

```bash
cd /path/to/your/project
bolt init
```

`bolt init` 会写入 `bolt.yaml`：一个 `hello` task 和一个 `demo` flow。它不会写入 `bolt.local.yaml`。

```bash
bolt run demo --dry-run
bolt run demo
```

## 工作原理

Bolt 只有两个构建块：

- **task（任务）** 是一个命名的步骤列表（唯一的构建块）。
- **flow（流程）** 是一组有序的 task。Flow 是**快速失败**的：第一个失败的 task 会中止整个流程，除非它被列入 `continue_on_fail`。

一切都通过一个动词 `bolt run` 执行。传入任务名按你输入的顺序运行，或传入单个 flow 名运行预定义目标。你输入什么就运行什么——没有隐藏的重排序。

```yaml
# bolt.yaml
version: 1

project:
  name: MyGame

plugins:
  - namespace: ue
    config:
      engine: { path: C:/UnrealEngine, vcs: git, branch: main }
      project: { path: C:/Projects/MyGame, vcs: svn }
      uproject: C:/Projects/MyGame/MyGame.uproject
      targets:
        editor: { kind: editor, config: development }
  - namespace: svn
    config:
      use_tortoise: true

tasks:
  kill: [{ uses: ue/kill }]
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build }]
  start: [{ uses: ue/start }]

flows:
  daily:
    description: 更新、构建并启动编辑器
    steps: [update, build, start]
    continue_on_fail: [start] # update/build 失败则中止；start 允许失败
```

然后在一条命令中运行任意组合：

```
bolt run kill update build start     # 临时：按输入顺序运行任务
bolt run build                       # 仅重新构建编辑器
bolt run build --config=debug        # 参数取代旧的变体（variant）
bolt run build_editor --config=debuggame # 别名：dbggame、DebugGame
bolt run daily                       # 运行预定义 flow
```

## 命令

| 命令                      | 描述                                    |
| ------------------------- | --------------------------------------- |
| `bolt run <names...>`     | 按输入顺序运行任务，或运行单个 flow     |
| `bolt list`               | 列出所有 task 和 flow                   |
| `bolt inspect <names...>` | 显示某个 task 或 flow 解析后的步骤      |
| `bolt info`               | 显示项目和 VCS 状态                     |
| `bolt check`              | 校验 `bolt.yaml`                        |
| `bolt init`               | 生成 `bolt.yaml`                        |
| `bolt config`             | 在 `$EDITOR` 中打开当前 `bolt.yaml`     |
| `bolt ai`                 | 为 LLM agent 生成 `.bolt/ai-context.md` |
| `bolt version`            | 打印版本                                |
| `bolt self-update`        | 更新到最新版本                          |
| `bolt plugin list`        | 列出活动插件及其处理器                  |
| `bolt plugin new <name>`  | 创建新插件脚手架                        |

## 配置

共享配置在 `bolt.yaml` 中，并以 `version: 1` 开头。`project` 只是名称。虚幻引擎、项目和 target 元数据属于 `ue` 插件。`bolt.local.yaml` 是可选的，只能覆盖 `vars`。

### bolt.yaml（共享，提交）

```yaml
version: 1

project:
  name: MyGame

plugins:
  - namespace: ue
    config:
      engine:
        path: C:/UnrealEngine # 本机 UE 根目录
        vcs: git # git | svn
        branch: main
      project:
        path: C:/Projects/MyGame
        vcs: svn # git | svn
      uproject: C:/Projects/MyGame/MyGame.uproject
      targets:
        editor:
          kind: editor # editor | program | game | client | server
          config: development # development | debug | debuggame | shipping | test
        client:
          kind: program
          name: MyClient
          config: shipping
  - namespace: svn
    config:
      use_tortoise: true # 可选：SVN 操作使用 TortoiseSVN/Proc

tasks:
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build }]
  start: [{ uses: ue/start }]

flows:
  daily:
    steps: [update, build, start]
    continue_on_fail: [start]

timeout_hours: 6 # 可选：运行超过该时长则中止
```

### bolt.local.yaml（可选，gitignore）

```yaml
vars:
  region: eu # 覆盖 bolt.yaml 中的同名键
```

插件配置中的相对路径以 `bolt.yaml` 所在目录为基准解析。

### 任务 (Tasks)

task 是一个命名的步骤列表。三个执行键含义明确：`uses` 调用插件/本地 action，`call` 复用 task，`run` 执行 shell 命令：

```yaml
tasks:
  build:
    - uses: ue/build
      with:
        target: editor
  reset:
    - uses: ue/kill
      continue-on-error: true # 步骤级：出错不中止整个运行
    - call: update # 内联复用另一个 task
    - call: build
  notify:
    - run: echo "done at ${{ env.TIME }}"
```

这是有意的 v2 破坏性变更：旧的 `uses: task/name` 会被拒绝。请改为 `call: name`；`uses` 只表示插件/本地 action。

按输入顺序临时运行任务。`--key=value` 参数作用于整个运行，并覆盖 `with:` 的值：

```
bolt run reset build start
bolt run build --target=client --config=shipping
bolt run build_editor --config=debuggame # 别名：dbggame、DebugGame
bolt run update build --dry-run
bolt run build -- extra=--verbose # 以 -- 开头的值放在单独的 -- 之后
```

参数解析是严格的：未知 flag、`--dry-run=<值>`、以 `--` 开头的参数值、写在子命令前面的 flag（`bolt --dry-run run …`），以及把保留名 `dry-run`、`simulate`、`json`、`agent`、`execute`、`plan`、`confirmed-by-user`，另加单独处理的 `help`，用作参数，都会在执行前以退出码 2 报错。输错命令或任务名（`bolt rn mark`、`bolt run mrk`）同样以退出码 2 报错，并给出 “Did you mean” 建议；不带任务名的 `bolt run` 会列出项目里的任务。保留名区分大小写。

### 流程 (Flows)

flow 是由 task 组成的命名有序目标。Flow 是快速失败的——第一个失败的 task 会中止运行——除非该 task 被列入 `continue_on_fail`：

```yaml
flows:
  daily:
    description: 更新、构建并启动编辑器
    steps: [update, build, start]
    continue_on_fail: [start] # update/build 中止；start 允许失败
  reset:
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill] # kill 允许失败（没有进程在运行）而不中止
```

```
bolt run daily
bolt run reset --dry-run
```

### 通知

在构建开始、完成或失败时获取通知：

```yaml
notifications:
  on_start: true
  on_complete: true
  on_failure: true
  providers:
    - type: wecom
      webhook_url: https://qyapi.weixin.qq.com/...
    - type: telegram
      bot_token: "123:ABC"
      chat_id: "-100..."
```

多 task 调用只发送一次开始通知；其中显示顶层 task 列表，以及每个 task 递归拥有的 `call`、插件/本地 action 和 shell 命令。

## 内置处理器

| 处理器                                                                            | 描述                                 |
| --------------------------------------------------------------------------------- | ------------------------------------ |
| `ue/build`                                                                        | 构建编辑器、程序或游戏目标           |
| `ue/build_engine`                                                                 | 构建 UE 引擎本身                     |
| `ue/build_program`                                                                | 构建独立程序目标                     |
| `ue/start`                                                                        | 启动 UE 编辑器或已构建的二进制文件   |
| `ue/kill`                                                                         | 终止所有运行中的 UE 进程             |
| `ue/update_engine`                                                                | 更新引擎仓库（git/svn）              |
| `ue/update_project`                                                               | 更新项目仓库（git/svn）              |
| `ue/setup`                                                                        | 运行引擎 `Setup.bat`                 |
| `ue/svn_cleanup`                                                                  | 运行 SVN cleanup（支持 TortoiseSVN） |
| `ue/svn_revert`                                                                   | 还原 SVN 更改                        |
| `ue/generate_project`                                                             | 重新生成项目文件                     |
| `ue/fillddc`                                                                      | 填充 Derived Data Cache              |
| `ue/fix_dll`                                                                      | 删除导致链接器错误的零字节 DLL       |
| `ue/info`                                                                         | 打印项目和 VCS 信息                  |
| `ue/ini_set`、`ue/ini_get`、`ue/ini_remove`、`ue/ini_override`、`ue/ini_read_all` | 编辑 UE `.ini` 配置                  |

## 插件

Bolt 是可扩展的。为内置处理器未覆盖的任何内容添加你自己的处理器——部署构建、发送 Slack 消息、运行自定义工具。

### 创建插件

```
bolt plugin new myplugin           # 项目范围
bolt plugin new myplugin --user    # 用户范围 (~/.bolt/plugins/)
```

```
cd .bolt/plugins/myplugin
bolt types
```

```typescript
import type { BoltPlugin } from "boltstack";

const plugin: BoltPlugin = {
  namespace: "myplugin",
  handlers: {
    deploy: async (params, ctx) => {
      ctx.logger.info(`Deploying to ${params.env}...`);
    },
  },
};

export default plugin;
```

在 task 中使用：

```yaml
tasks:
  deploy:
    - uses: myplugin/deploy
      with:
        env: staging
```

### 插件范围

| 范围     | 位置                                | 优先级 |
| -------- | ----------------------------------- | ------ |
| 内置     | 编译到 bolt 中                      | 最低   |
| 用户     | `~/.bolt/plugins/<name>/`           | ↑      |
| 项目自动 | `.bolt/plugins/<name>/`             | ↑      |
| 项目显式 | 在 `bolt.yaml` 的 `plugins:` 中声明 | 最高   |

高优先级插件会覆盖同一命名空间的低优先级插件，因此你可以覆盖任何内置行为。

### 类型定义

`bolt types` 根据正在运行的 bolt 写入 `.bolt/types/boltstack.d.ts`，以及把模块名 `boltstack` 映射到该文件的 `tsconfig.json`。类型与这个二进制一致。不要再下载一份单独的 `bolt.d.ts`，也不要通过 npm 安装另一份类型。

```bash
bolt types
```

## 库使用

Bolt 也可以作为库用于编程式工作流自动化。支持 Bun 和 Node.js。

### 安装

```bash
npm install boltstack
# 或
bun add boltstack
```

### 高级 API

```typescript
import { run, createContext } from "boltstack";

// 运行命名任务；参数作用于每个步骤
await run("build", {
  configPath: "./bolt.yaml",
  params: { target: "client" },
  dryRun: false,
});

// 创建上下文用于直接调用插件
const ctx = createContext({
  project: { name: "MyGame" },
  dryRun: false,
});
```

### 直接访问插件

```typescript
import { fs } from "boltstack/plugins";
import { createContext } from "boltstack";

const ctx = createContext({
  project: { name: "MyGame" },
});

await fs.handlers.copy({ src: "a.txt", dst: "b.txt" }, ctx);
```

### 核心内部

```typescript
import { Runner, Logger, createRuntime } from "boltstack/core";
import { loadConfig } from "boltstack";

const config = await loadConfig("./bolt.yaml", createRuntime());
const runner = new Runner(config, { logger: new Logger() });

await runner.runTask("build", {}); // 运行 task
await runner.runFlow("daily"); // 运行 flow
```

### 子路径导出

- `boltstack` - 高级 API（run、createContext、loadConfig、checkConfig）
- `boltstack/plugins` - 内置插件（git、svn、ue、fs、json）
- `boltstack/core` - 核心内部（Runner、Logger、createRuntime）

### 运行时兼容性

库使用运行时抽象层：

- **Bun**: 使用原生 API（Bun.spawn、Bun.YAML）
- **Node.js**: 使用 child_process 和 yaml 包

CLI 仍仅支持 Bun 以获得最佳性能，但库可在任何地方运行。

## 文档

完整文档位于 `apps/docs`（Mintlify）：

- **指南**：快速开始、安装、第一个项目
- **工作原理**：架构、插件系统、运行时
- **CLI 参考**：每个命令的文档
- **API 参考**：插件 API、配置模式、内置处理器、库使用
- **配置**：bolt.yaml 模式、插值、故障排查

## 开发

需要 [Bun](https://bun.sh)。

```bash
bun install
bun run dev          # 从源码运行
bun test             # 运行测试
bun run build:types  # 重新生成 bolt.d.ts
# 在 main 上打标签发布：git tag vX.Y.Z && git push origin vX.Y.Z
# 见 docs/ops/release.md。不会发布到 npm。
```

## 许可证

Apache-2.0
