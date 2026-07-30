# ⚡Bolt

[English](README.md) | 简体中文

> *本文由 AI 翻译，可能存在不准确之处，将在后续版本中人工校正。*

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

**macOS (Apple Silicon)**
```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
```

安装 `bolt` 到 `~/.bolt/bin/` 并添加到 PATH。更新方式：

```
bolt self-update
```

## 快速开始

安装后，在你的项目中生成配置：

```bash
cd /path/to/your/ue/project
bolt init
```

`bolt init` 会写入两个文件：

1. `bolt.yaml`——共享、提交到版本库的契约（项目标识、tasks、flows）。不含机器路径。
2. `bolt.local.yaml`——本机路径（引擎/项目/uproject），已 gitignore。`bolt init` 会尝试自动探测你的 `.uproject`。

编辑 `bolt.local.yaml` 里的路径，然后运行：

```bash
bolt run daily --dry-run     # 预览
bolt run daily               # 执行
```

## 工作原理

Bolt 只有两个构建块：

- **task（任务）** 是一个命名的步骤列表（唯一的构建块）。
- **flow（流程）** 是一组有序的 task。Flow 是**快速失败**的：第一个失败的 task 会中止整个流程，除非它被列入 `continue_on_fail`。

一切都通过一个动词 `bolt run` 执行。传入任务名按你输入的顺序运行，或传入单个 flow 名运行预定义目标。你输入什么就运行什么——没有隐藏的重排序。

```yaml
# bolt.yaml——共享契约，提交到版本库（不含机器路径）
project:
  name: MyGame
  engine: { vcs: git, branch: main }
  project: { vcs: svn }

tasks:
  kill:    [{ uses: ue/kill }]
  update:  [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:   [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build }]
  start:   [{ uses: ue/start }]

flows:
  daily:
    description: 更新、构建并启动编辑器
    steps: [update, build, start]
    continue_on_fail: [start]    # update/build 失败则中止；start 允许失败
```

```yaml
# bolt.local.yaml——本机路径，已 gitignore
engine_path:  C:/UnrealEngine
project_path: C:/Projects/MyGame
uproject:     C:/Projects/MyGame/MyGame.uproject
use_tortoise: true
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

| 命令 | 描述 |
|---------|-------------|
| `bolt run <names...>` | 按输入顺序运行任务，或运行单个 flow |
| `bolt list` | 列出所有 task 和 flow |
| `bolt inspect <names...>` | 显示某个 task 或 flow 解析后的步骤 |
| `bolt info` | 显示项目和 VCS 状态 |
| `bolt check` | 校验 `bolt.yaml` 和 `bolt.local.yaml` |
| `bolt init` | 生成 `bolt.yaml` + `bolt.local.yaml` |
| `bolt config` | 在 `$EDITOR` 中打开当前 `bolt.yaml` |
| `bolt ai` | 为 LLM agent 生成 `.bolt/ai-context.md` |
| `bolt version` | 打印版本 |
| `bolt self-update` | 更新到最新版本 |
| `bolt plugin list` | 列出活动插件及其处理器 |
| `bolt plugin new <name>` | 创建新插件脚手架 |

## 配置

配置分成两部分：你提交的共享 `bolt.yaml`，以及你 gitignore 的本机 `bolt.local.yaml`。Bolt 在加载时将两者合并，因此插件处理器看到的是统一的 project。

### bolt.yaml（共享，提交）

```yaml
project:
  name: MyGame
  engine:                    # 仅仓库标识——路径在 bolt.local.yaml 中
    vcs: git                 # git | svn
    url: ""                  # 可选：远程 URL
    branch: main             # 可选：用于 git 仓库
  project:
    vcs: svn                 # git | svn
    url: ""                  # 可选：远程 URL

targets:
  editor:
    kind: editor             # editor | program | game | client | server
    config: development      # development | debug | debuggame | shipping | test
  client:
    kind: program
    name: MyClient
    config: shipping

tasks:
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:  [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build }]
  start:  [{ uses: ue/start }]

flows:
  daily:
    steps: [update, build, start]
    continue_on_fail: [start]

timeout_hours: 6             # 可选：运行超过该时长则中止
```

### bolt.local.yaml（本机，gitignore）

```yaml
engine_path:  C:/UnrealEngine                       # 本机 UE 根目录
project_path: C:/Projects/MyGame                    # 本机项目工作副本
uproject:     C:/Projects/MyGame/MyGame.uproject    # .uproject 文件
use_tortoise: true                                  # 可选：SVN 操作使用 TortoiseSVN/Proc
```

`bolt.local.yaml` 中的相对路径以 `bolt.yaml` 所在目录为基准解析。

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
      continue-on-error: true    # 步骤级：出错不中止整个运行
    - call: update               # 内联复用另一个 task
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
```

### 流程 (Flows)

flow 是由 task 组成的命名有序目标。Flow 是快速失败的——第一个失败的 task 会中止运行——除非该 task 被列入 `continue_on_fail`：

```yaml
flows:
  daily:
    description: 更新、构建并启动编辑器
    steps: [update, build, start]
    continue_on_fail: [start]    # update/build 中止；start 允许失败
  reset:
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]     # kill 允许失败（没有进程在运行）而不中止
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

| 处理器 | 描述 |
|---------|-------------|
| `ue/build` | 构建编辑器、程序或游戏目标 |
| `ue/build_engine` | 构建 UE 引擎本身 |
| `ue/build_program` | 构建独立程序目标 |
| `ue/start` | 启动 UE 编辑器或已构建的二进制文件 |
| `ue/kill` | 终止所有运行中的 UE 进程 |
| `ue/update_engine` | 更新引擎仓库（git/svn） |
| `ue/update_project` | 更新项目仓库（git/svn） |
| `ue/setup` | 运行引擎 `Setup.bat` |
| `ue/svn_cleanup` | 运行 SVN cleanup（支持 TortoiseSVN） |
| `ue/svn_revert` | 还原 SVN 更改 |
| `ue/generate_project` | 重新生成项目文件 |
| `ue/fillddc` | 填充 Derived Data Cache |
| `ue/fix_dll` | 删除导致链接器错误的零字节 DLL |
| `ue/info` | 打印项目和 VCS 信息 |
| `ue/ini_set`、`ue/ini_get`、`ue/ini_remove`、`ue/ini_override`、`ue/ini_read_all` | 编辑 UE `.ini` 配置 |

## 插件

Bolt 是可扩展的。为内置处理器未覆盖的任何内容添加你自己的处理器——部署构建、发送 Slack 消息、运行自定义工具。

### 创建插件

```
bolt plugin new myplugin           # 项目范围
bolt plugin new myplugin --user    # 用户范围 (~/.bolt/plugins/)
```

```
cd .bolt/plugins/myplugin
bun install    # 设置 IDE 类型支持
```

```typescript
import type { BoltPlugin } from "bolt";

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

| 范围 | 位置 | 优先级 |
|-------|----------|----------|
| 内置 | 编译到 bolt 中 | 最低 |
| 用户 | `~/.bolt/plugins/<name>/` | ↑ |
| 项目自动 | `.bolt/plugins/<name>/` | ↑ |
| 项目显式 | 在 `bolt.yaml` 的 `plugins:` 中声明 | 最高 |

高优先级插件会覆盖同一命名空间的低优先级插件，因此你可以覆盖任何内置行为。

### 类型定义

插件类型通过 `boltstack` npm 包提供：

```
bun add -d boltstack
```

安装后 `import type { BoltPlugin, BoltPluginContext } from "bolt"` 可以正确解析。脚手架会自动设置。

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
  project: {
    name: "MyGame",
    engine_repo: { path: "C:/UnrealEngine", vcs: "git" },
    project_repo: { path: "C:/Projects/MyGame", vcs: "svn" },
    uproject: "C:/Projects/MyGame/MyGame.uproject",
  },
  dryRun: false,
});
```

### 直接访问插件

```typescript
import { ue, fs } from "boltstack/plugins";
import { createContext } from "boltstack";

const ctx = createContext({
  project: {
    name: "MyGame",
    engine_repo: { path: "C:/UnrealEngine", vcs: "git" },
    project_repo: { path: "C:/Projects/MyGame", vcs: "svn" },
    uproject: "C:/Projects/MyGame/MyGame.uproject",
  },
});

await ue.handlers.build({ target: "editor" }, ctx);
```

### 核心内部

```typescript
import { Runner, Logger, createRuntime } from "boltstack/core";
import { loadConfig } from "boltstack";

const config = await loadConfig("./bolt.yaml", createRuntime());
const runner = new Runner(config, { logger: new Logger() });

await runner.runTask("build", {});   // 运行 task
await runner.runFlow("daily");        // 运行 flow
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
bun test             # 运行测试（需要 bolt.local.yaml 配置本机路径）
bun run build:types  # 重新生成 bolt.d.ts
bun run release:dry  # 预览发布流程
```

## 许可证

Apache-2.0
