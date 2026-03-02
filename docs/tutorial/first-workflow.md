# First Workflow

Create your first Bolt workflow and run it.

## Prerequisites

- Bolt installed ([Installation guide](/tutorial/installation))
- An Unreal Engine project (C++ or Blueprint)
- Source control set up (Git or SVN)

## Step 1: Initialize bolt.yaml

Navigate to your project root and create a `bolt.yaml` file:

```bash
cd C:/Projects/MyGame
```

Create `bolt.yaml` with your project details:

```yaml
project:
  name: MyGame
  engine_root: C:/UnrealEngine        # Path to UE engine
  project_root: C:/Projects/MyGame    # Path to your project
  project_name: MyGame                # Project name (without .uproject)
  engine_vcs: git                     # Version control for engine
  project_vcs: svn                    # Version control for project
```

### Finding Your Paths

- **engine_root**: Directory containing `Engine/Build/BatchFiles/Build.bat`
- **project_root**: Directory containing your `.uproject` file
- **project_name**: Name of your `.uproject` file without extension

## Step 2: Define Targets

Targets describe what you're building:

```yaml
targets:
  editor:
    kind: editor
    config: development
  
  game-client:
    kind: client
    name: MyGameClient
    config: shipping
```

**Target types:**
- `editor` - UE Editor
- `program` - Standalone program
- `game` - Game build
- `client` - Game client
- `server` - Dedicated server

**Build configurations:**
- `development` - Default, with debugging
- `debug` - Full debug symbols
- `shipping` - Optimized release
- `test` - For automated testing

## Step 3: Define Ops

Ops are reusable steps that can be chained:

```yaml
ops:
  update:
    default:
      - uses: ue/update
  
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    
    client:
      - uses: ue/build
        with:
          target: game-client
  
  start:
    default:
      - uses: ue/start
        with:
          target: editor
  
  kill:
    default:
      - uses: ue/kill
```

## Step 4: Define Pipeline Order

Control the execution order:

```yaml
go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build  # Stop if build fails
```

Bolt will always run ops in this order, regardless of how you specify them.

## Step 5: Run Your Workflow

Now you can run operations:

```bash
# Update source control
bolt go update

# Build the editor
bolt go build

# Build and launch
bolt go build start

# Full workflow: kill processes, update, build, launch
bolt go kill update build start

# Build client variant
bolt go build:client
```

### Passing Parameters

Override configuration at runtime:

```bash
# Build with debug config
bolt go build --config=debug

# Build and start with shipping config
bolt go build start --config=shipping

# Build specific target
bolt go build --target=game-client
```

### Dry Run

See what Bolt would do without executing:

```bash
bolt go build --dry-run
```

## Step 6: Check Status

View your project configuration:

```bash
bolt info
```

Validate your `bolt.yaml`:

```bash
bolt check
```

## Common Patterns

### Daily Development

```bash
bolt go update build start
```

### Clean Rebuild

```bash
bolt go kill update build start
```

### Shipping Build

```bash
bolt go build:client --config=shipping
```

## Next Steps

- [Create custom ops](/tutorial/custom-ops)
- [Explore all handlers](/api/handlers)
- [Learn about actions](/api/config#actions)
