import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = path.join(root, "android");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const buildNumber = Number(process.env.GITHUB_RUN_NUMBER || process.env.VIVID_ANDROID_BUILD || 1);
if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) throw new Error("Android build number must be a positive integer.");
const versionCode = 100000 + buildNumber;
const versionName = packageJson.version;
const gradlePath = path.join(androidRoot, "app", "build.gradle");
let gradle = await readFile(gradlePath, "utf8");
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+["'][^"']+["']/.test(gradle)) {
  throw new Error("Could not find Android versionCode/versionName in generated app/build.gradle.");
}
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+["'][^"']+["']/, `versionName "${versionName}"`);
await writeFile(gradlePath, gradle, "utf8");

const javaRoot = path.join(androidRoot, "app", "src", "main", "java", "com", "vividcinema", "app");
const mainActivityPath = path.join(javaRoot, "MainActivity.java");
const pluginPath = path.join(javaRoot, "VividUpdaterPlugin.java");
let mainActivity = await readFile(mainActivityPath, "utf8");
if (!mainActivity.includes("VividUpdaterPlugin.class")) {
  mainActivity = mainActivity.replace(
    /public class MainActivity extends BridgeActivity\s*\{/,
    "public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(VividUpdaterPlugin.class);\n        super.onCreate(savedInstanceState);\n    }"
  );
}
if (!mainActivity.includes("VividUpdaterPlugin.class")) throw new Error("Could not register VividUpdaterPlugin in MainActivity.");
await writeFile(mainActivityPath, mainActivity, "utf8");

const plugin = `package com.vividcinema.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.URLUtil;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicLong;

@CapacitorPlugin(name = "VividUpdater")
public class VividUpdaterPlugin extends Plugin {
    private final AtomicLong activeDownload = new AtomicLong(-1);
    private BroadcastReceiver receiver;

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != activeDownload.get()) return;
                DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
                Uri uri = manager == null ? null : manager.getUriForDownloadedFile(id);
                if (uri == null) return;
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    context.startActivity(install);
                } catch (Exception error) {
                    android.util.Log.e("VividUpdater", "Could not open Android package installer", error);
                }
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://github.com/") || url.startsWith("https://objects.githubusercontent.com/") || url.startsWith("https://release-assets.githubusercontent.com/"))) {
            call.reject("A valid official GitHub APK URL is required.");
            return;
        }
        try {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("Android download service is unavailable.");
                return;
            }
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Vivid Cinema update");
            request.setDescription("Downloading Vivid Cinema " + (call.getString("version", "latest")));
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, "Vivid-Cinema-Update.apk");
            long id = manager.enqueue(request);
            activeDownload.set(id);
            JSObject result = new JSObject();
            result.put("downloadId", id);
            result.put("message", "Download started. Android will open the installer when the APK finishes downloading.");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not start the Android update download.", error);
        }
    }
}
`;
await writeFile(pluginPath, plugin, "utf8");

const manifestPath = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
let manifest = await readFile(manifestPath, "utf8");
if (!manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
  manifest = manifest.replace("<manifest ", '<manifest ');
  manifest = manifest.replace(/<application\b/, '    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n\n    <application');
  await writeFile(manifestPath, manifest, "utf8");
}
console.log(`Configured Vivid Android updater plugin (version ${versionName}, build ${buildNumber}, versionCode ${versionCode}).`);
