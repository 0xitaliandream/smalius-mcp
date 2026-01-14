# sniaff-android-mcp

MCP server for Android emulator session management.

## Prerequisites

### 1. Java Development Kit (OpenJDK 17)

```bash
brew install openjdk@17
```

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export PATH="$JAVA_HOME/bin:$PATH"
```

### 2. Android SDK

Install Android Studio from [developer.android.com](https://developer.android.com/studio) or via Homebrew:

```bash
brew install --cask android-studio
```

After installation, open Android Studio and go to **Settings > Languages & Frameworks > Android SDK > SDK Tools** and install:

- Android SDK Command-line Tools (latest)
- Android SDK Platform-Tools
- Android Emulator

Add to your shell profile:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

### 3. Node.js (v18+)

```bash
brew install node
```

## Installation

```bash
cd sniaff-android-mcp
npm install
npm run build
```

## Configuration

Create a `.env` file (optional) or set environment variables:

```bash
# Workspace directory for sessions (default: ~/.sniaff/workspaces)
# SNIAFF_WORKSPACES_DIR=/path/to/workspaces

# Logs directory (default: ~/.sniaff/logs)
# SNIAFF_LOGS_DIR=/path/to/logs

# Executable paths (default: use PATH)
# SNIAFF_EMULATOR_PATH=emulator
# SNIAFF_ADB_PATH=adb

# Default port
# SNIAFF_EMULATOR_PORT=5554

# Timeouts (in milliseconds)
# SNIAFF_BOOT_TIMEOUT=120000
# SNIAFF_BOOT_POLL_INTERVAL=2000

# Limits
# SNIAFF_MAX_SESSIONS=10
# SNIAFF_PORT_RETRY_ATTEMPTS=5
```

## Adding to Claude Code

```bash
claude mcp add-json sniaff-android-mcp '{"command":"node","args":["/path/to/sniaff-android-mcp/build/index.js"]}'
```

## Available Tools

| Tool | Description |
|------|-------------|
| `sniaff.start` | Start a new Android emulator session |
| `sniaff.shell` | Execute shell commands on the emulator |
| `sniaff.tap` | Tap on screen coordinates |
| `sniaff.swipe` | Swipe on screen (by direction or coordinates) |
| `sniaff.long_press` | Long press on screen coordinates |
| `sniaff.ui_dump` | Dump UI hierarchy as XML |

## First Run

On first run, sniaff will automatically:

1. Download the required system image (Android 35, Google APIs + Play Store, arm64)
2. Create the `SniaffPhone` AVD
3. Root the AVD using rootAVD (installs Magisk)

This process takes several minutes on first run. Subsequent runs will reuse the existing AVD.

## Troubleshooting

### sdkmanager not found

Install Android SDK Command-line Tools from Android Studio:
- Settings > Languages & Frameworks > Android SDK > SDK Tools
- Check "Android SDK Command-line Tools (latest)"

### Java not found

Ensure OpenJDK 17 is installed and JAVA_HOME is set:

```bash
java -version
echo $JAVA_HOME
```

### Emulator won't start

Check that hardware acceleration is enabled:

```bash
emulator -accel-check
```

On macOS with Apple Silicon, the emulator uses native ARM64 support.

### rootAVD fails

Ensure the rootAVD script is executable:

```bash
chmod +x rootAVD-master/rootAVD.sh
```
