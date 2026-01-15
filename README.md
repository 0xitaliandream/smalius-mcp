# sniaff-android-mcp

MCP server for Android emulator session management with root access, UI automation, and network interception capabilities.

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

# AVD configuration
# SNIAFF_AVD_NAME=SniaffPhone
# SNIAFF_SYSTEM_IMAGE=system-images;android-35;google_apis_playstore;arm64-v8a
```

## Adding to Claude Code

```bash
claude mcp add-json sniaff-android-mcp '{"command":"node","args":["/path/to/sniaff-android-mcp/build/index.js"]}'
```

## Available Tools

### Session Management

| Tool | Description |
|------|-------------|
| `sniaff.start` | Start a new Android emulator session. Auto-creates and roots the AVD on first run. |

### UI Interaction

| Tool | Description |
|------|-------------|
| `sniaff.tap` | Tap on screen coordinates |
| `sniaff.swipe` | Swipe on screen (by direction or coordinates) |
| `sniaff.long_press` | Long press on screen coordinates |
| `sniaff.input_text` | Type text into the focused input field |
| `sniaff.key_event` | Send key events (BACK, HOME, ENTER, etc.) |
| `sniaff.ui_dump` | Dump UI hierarchy as XML |
| `sniaff.screenshot` | Capture screenshot and save to workspace |

### App Management

| Tool | Description |
|------|-------------|
| `sniaff.install_apk` | Install an APK file on the emulator |
| `sniaff.shell` | Execute shell commands on the emulator |

### Network

| Tool | Description |
|------|-------------|
| `sniaff.set_proxy` | Configure HTTP proxy (for MITM interception) |
| `sniaff.remove_proxy` | Remove proxy settings |

## Tool Examples

### Start a session

```json
{
  "tool": "sniaff.start",
  "input": {
    "headless": false,
    "bootTimeout": 120000
  }
}
```

### Install an APK

```json
{
  "tool": "sniaff.install_apk",
  "input": {
    "sessionId": "sess-xxx",
    "apkPath": "/path/to/app.apk",
    "reinstall": true,
    "grantRuntimePermissions": true
  }
}
```

### Take a screenshot

```json
{
  "tool": "sniaff.screenshot",
  "input": {
    "sessionId": "sess-xxx",
    "label": "login_screen"
  }
}
```

### Type text

```json
{
  "tool": "sniaff.input_text",
  "input": {
    "sessionId": "sess-xxx",
    "text": "hello@example.com"
  }
}
```

### Send key event

```json
{
  "tool": "sniaff.key_event",
  "input": {
    "sessionId": "sess-xxx",
    "key": "BACK"
  }
}
```

Supported keys: `HOME`, `BACK`, `MENU`, `APP_SWITCH`, `ENTER`, `TAB`, `SPACE`, `DEL`, `ESCAPE`, `VOLUME_UP`, `VOLUME_DOWN`, `DPAD_UP`, `DPAD_DOWN`, `DPAD_LEFT`, `DPAD_RIGHT`, `DPAD_CENTER`, `F1`-`F12`, or numeric key codes.

### Configure proxy for MITM

```json
{
  "tool": "sniaff.set_proxy",
  "input": {
    "sessionId": "sess-xxx",
    "host": "10.0.2.2",
    "port": 8080
  }
}
```

Note: Use `10.0.2.2` to reach the host machine from the emulator.

## First Run

On first run, sniaff will automatically:

1. Download the required system image (Android 35, Google APIs + Play Store, arm64)
2. Create the `SniaffPhone` AVD
3. Root the AVD using rootAVD (installs Magisk)
4. Verify root access post-boot

**Important:** After the first boot, you need to complete the Magisk setup:
- Open the Magisk app on the emulator
- Tap "OK" when prompted to complete installation
- The device will reboot automatically

This is a one-time setup. Subsequent runs will reuse the existing rooted AVD.

### Root Check

After each boot, sniaff verifies that root access is working. If root check fails (e.g., corrupted AVD), it will automatically:
1. Delete the existing AVD
2. Recreate and re-root the AVD
3. Restart the emulator

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

### Root check fails repeatedly

If root keeps failing after AVD recreation:
1. Check that rootAVD completed successfully in the logs
2. Ensure no antivirus is blocking the emulator
3. Try manually running rootAVD on the system image

### Proxy not working

- Use `10.0.2.2` as the proxy host (Android's alias for host localhost)
- Ensure your proxy server is listening on the specified port
- For HTTPS interception, install the CA certificate on the emulator
