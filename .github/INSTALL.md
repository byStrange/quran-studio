## Installing

### macOS (`.dmg`)

The app is not notarized by Apple yet, so macOS asks you to confirm it once.

1. Open the `.dmg` and drag **Quran Studio** into **Applications**.
2. Open Quran Studio from Applications. macOS says it cannot verify the app — click **Done** (not *Move to Trash*).
3. Go to **System Settings → Privacy & Security**, scroll down to **Security**, and click **Open Anyway** next to "Quran Studio was blocked". Confirm with your password.

From then on it opens normally. On macOS 14 (Sonoma) or older, you can instead Control-click the app, choose **Open**, then **Open** again.

If macOS says the app **"is damaged and can't be opened"**, run this in Terminal and open it again:

```
xattr -dr com.apple.quarantine "/Applications/Quran Studio.app"
```

The one DMG runs on both Apple Silicon and Intel Macs.

### Windows (`setup.exe`)

Run the installer. If SmartScreen shows "Windows protected your PC", click **More info → Run anyway**.

### Linux (`.AppImage`)

Make it executable and run it: `chmod +x quran-studio*.AppImage && ./quran-studio*.AppImage`

### Android (`.apk`)

Open the APK on your phone and allow installs from that source when asked.
