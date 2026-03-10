# ⚡Bolt

[English](README.md) | 简体中文

> *本文由 AI 翻译，可能存在不准确之处，将在后续版本中人工校正。*

自动化你的虚幻引擎日常工作流程。

Bolt 是一个 CLI 工具，将重复的 UE 任务——更新源代码控制、重新构建编辑器、启动游戏、填充 DDC——转化为可以链式调用、脚本化和与团队共享的单行命令。

```
bolt go update build start
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

安装后，使用交互式设置初始化你的项目：

```bash
cd /path/to/your/ue/project
bolt init
```

这将：
1. 询问你的项目结构（UE 路径、项目路径、版本控制）
2. 生成带有合理默认值的 `bolt.yaml` 配置文件
3. 设置常用操作（update、build、start、kill）
4. 配置你的 go 流水线

生成的配置完全可定制——编辑 `bolt.yaml` 添加自定义操作、动作或插件。

## 工作原理

定义你的项目：

```yaml
# bolt.yaml
project:
  name: MyGame
  engine_repo:
    path: C:/UnrealEngine
    vcs: git
    branch: main
  project_repo:
    path: C:/Projects/MyGame
    vcs: svn
  uproject: C:/Projects/MyGame/MyGame.uproject
```

然后在一条命令中运行任意操作组合：

```
bolt go kill update build start      # 完全重置并重新构建
bolt go build                        # 仅重新构建编辑器
bolt go update:svn build --config=debug   # SVN 更新后 debug 构建
bolt go build start --config=shipping    # shipping 构建并启动
```

Bolt 会正确按顺序执行它们，在关键失败时停止，在非关键失败时继续。

## 命令

| 命令 | 描述 |
|---------|-------------|
| `bolt go <ops...>` | 按流水线顺序运行一个或多个操作 |
| `bolt run <action>` | 运行 bolt.yaml 中的命名动作 |
| `bolt list` | 列出所有可用的操作和动作 |
| `bolt info` | 显示项目和 VCS 状态 |
| `bolt check` | 验证 bolt.yaml |
| `bolt version` | 打印版本 |
| `bolt self-update` | 更新到最新版本 |
| `bolt plugin list` | 列出活动插件及其处理器 |
| `bolt plugin new <name>` | 创建新插件脚手架 |

## bolt.yaml

### 项目

```yaml
project:
  name: MyGame
  engine_repo:
    path: C:/UnrealEngine
    vcs: git                   # git | svn
    url: ""                    # 可选：远程 URL
    branch: main               # 可选：用于 git 仓库
  project_repo:
    path: C:/Projects/MyGame
    vcs: svn                   # git | svn
    url: ""                    # 可选：远程 URL
    branch: main               # 可选：用于 git 仓库
  uproject: C:/Projects/MyGame/MyGame.uproject
  use_tortoise: true           # 可选：true | false | auto-detect
```

### 目标

```yaml
targets:
  editor:
    kind: editor               # editor | program | game | client | server
    config: development        # development | debug | shipping | test
  client:
    kind: program
    name: MyClient
    config: shipping
```

### 操作 (Ops)

操作是由 `bolt go` 调用的命名、可复用步骤。每个操作可以有命名变体：

```yaml
ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    editor:
      - uses: ue/build
        with:
          target: editor
    program:
      - uses: ue/build
        with:
          target: client
```

运行时选择变体：

```
bolt go build:program
bolt go --build=program
```

### Go 流水线

控制执行顺序和失败行为：

```yaml
go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build      # 如果构建失败则停止运行；其他操作失败时继续
```

`bolt go` 始终遵循流水线顺序，无论参数顺序如何：

```
bolt go start build    # 先执行 build，然后 start
```

### 动作 (Actions)

`bolt run` 的命名配置文件——可组合，支持依赖：

```yaml
actions:
  full_reset:
    steps:
      - uses: ue/kill
        continue-on-error: true
      - uses: ops/update
      - uses: ops/build

  daily_check:
    depends:
      - full_reset
    steps:
      - uses: ops/start
```

```
bolt run full_reset
bolt run daily_check    # 先运行 full_reset，然后启动
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

### 超时

```yaml
timeout_hours: 6
```

## 内置处理器

| 处理器 | 描述 |
|---------|-------------|
| `ue/build` | 构建编辑器、程序或游戏目标 |
| `ue/build_engine` | 构建 UE 引擎本身 |
| `ue/build_program` | 构建独立程序目标 |
| `ue/start` | 启动 UE 编辑器或已构建的二进制文件 |
| `ue/kill` | 终止所有运行中的 UE 进程 |
| `ue/update-git` | 从 git 拉取最新代码 |
| `ue/update-svn` | 更新 SVN 工作副本 |
| `ue/svn_cleanup` | 运行 SVN cleanup（支持 TortoiseSVN） |
| `ue/svn_revert` | 还原 SVN 更改 |
| `ue/generate_project` | 重新生成项目文件 |
| `ue/fillddc` | 填充 Derived Data Cache |
| `ue/fix_dll` | 删除导致链接器错误的零字节 DLL |
| `ue/info` | 打印项目和 VCS 信息 |
| `fs/copy`, `fs/move`, `fs/delete`, `fs/mkdir` | 文件系统操作 |
| `json/set`, `json/merge` | JSON 文件操作 |

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

在 bolt.yaml 中使用：

```yaml
ops:
  deploy:
    default:
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

插件类型通过 `bolt-ue` npm 包提供：

```
bun add -d bolt-ue
```

安装后 `import type { BoltPlugin, BoltPluginContext } from "bolt"` 可以正确解析。脚手架会自动设置。

## 库使用

Bolt 也可以作为库用于编程式工作流自动化。支持 Bun 和 Node.js。

### 安装

```bash
npm install bolt-ue
# 或
bun add bolt-ue
```

### 高级 API

```typescript
import { run, go, createContext } from "bolt-ue";

// 运行命名动作
await run("build", {
  configPath: "./bolt.yaml",
  dryRun: false
});

// 通过流水线运行操作
await go(["update", "build", "start"], {
  configPath: "./bolt.yaml"
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
import { git, fs, ue } from "bolt-ue/plugins";
import { createContext } from "bolt-ue";

const ctx = createContext({
  project: {
    name: "MyGame",
    engine_repo: { path: "C:/UnrealEngine", vcs: "git" },
    project_repo: { path: "C:/Projects/MyGame", vcs: "svn" },
    uproject: "C:/Projects/MyGame/MyGame.uproject",
  },
});

// 直接调用插件处理器
await git.handlers.pull({ path: "C:/UnrealEngine" }, ctx);
await fs.handlers.copy({
  src: "C:/src/file.txt",
  dst: "C:/dest/file.txt"
}, ctx);
```

### 核心内部

```typescript
import { Runner, Logger, createRuntime } from "bolt-ue/core";
import { loadConfig } from "bolt-ue";

const config = await loadConfig("./bolt.yaml");
const logger = new Logger();
const runtime = createRuntime(); // 自动检测 Bun vs Node.js

const runner = new Runner(config, { logger, runtime });
await runner.run("build");
```

### 子路径导出

- `bolt-ue` - 高级 API（run、go、createContext、loadConfig）
- `bolt-ue/plugins` - 内置插件（git、svn、ue、fs、json）
- `bolt-ue/core` - 核心内部（Runner、Logger、createRuntime）

### 运行时兼容性

库使用运行时抽象层：
- **Bun**: 使用原生 API（Bun.spawn、Bun.YAML）
- **Node.js**: 使用 child_process 和 yaml 包

CLI 仍仅支持 Bun 以获得最佳性能，但库可在任何地方运行。

## 文档

- [架构](docs/architecture.md)
- [配置参考](docs/config.md)
- [命令](docs/commands.md)
- [内置处理器](docs/handlers.md)
- [插件系统](docs/plugins.md)
- [Runner 内部](docs/runner.md)
- [发布流程](docs/release.md)

## 开发

需要 [Bun](https://bun.sh)。

```bash
bun install
bun run dev          # 从源码运行
bun test             # 运行测试（需要 .env.local 配置 UE_PATH）
bun run build:types  # 重新生成 bolt.d.ts
bun run release:dry  # 预览发布流程
```

## 许可证

Apache-2.0
