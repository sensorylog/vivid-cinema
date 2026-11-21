import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = process.env.VIVID_ANDROID_ROOT
  ? path.resolve(process.env.VIVID_ANDROID_ROOT)
  : path.join(root, "android");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const buildNumber = Number(process.env.VIVID_ANDROID_BUILD || process.env.GITHUB_RUN_NUMBER || 1);
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
for (const pluginClass of ["VividUpdaterPlugin.class", "VividNavigationPlugin.class"]) {
  if (mainActivity.includes(pluginClass)) continue;
  const superCall = /([ \\t]*)super\\.onCreate\\(savedInstanceState\\);/;
  if (superCall.test(mainActivity)) {
    mainActivity = mainActivity.replace(superCall, `$1registerPlugin(${pluginClass});\n$1super.onCreate(savedInstanceState);`);
  } else {
    mainActivity = mainActivity.replace(
      /public class MainActivity extends BridgeActivity\s*\{/,
      `public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(${pluginClass});\n        super.onCreate(savedInstanceState);\n    }`
    );
  }
}
if (!mainActivity.includes("VividUpdaterPlugin.class") || !mainActivity.includes("VividNavigationPlugin.class")) {
  throw new Error("Could not register all Vivid native plugins in MainActivity.");
}
if (!mainActivity.includes("VividWebChromeClient")) {
  const superCall = /([ \\t]*)super\\.onCreate\\(savedInstanceState\\);/;
  if (!superCall.test(mainActivity)) throw new Error("Could not install the Vivid fullscreen WebChromeClient.");
  mainActivity = mainActivity.replace(
    superCall,
    `$1super.onCreate(savedInstanceState);\\n$1if (getBridge() != null && getBridge().getWebView() != null) {\\n$1    getBridge().getWebView().setWebChromeClient(new VividWebChromeClient(getBridge()));\\n$1}`
  );
}
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
    private static final String PREFERENCES = "vivid_android_updater";
    private static final String ACTIVE_DOWNLOAD_ID = "active_download_id";
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
                openInstaller(context, id);
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }

        long savedId = getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getLong(ACTIVE_DOWNLOAD_ID, -1);
        activeDownload.set(savedId);
        if (savedId > 0) reconcileDownload(savedId);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        long id = activeDownload.get();
        if (id > 0) reconcileDownload(id);
    }

    private int getDownloadStatus(long id) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return -1;
        Cursor cursor = null;
        try {
            cursor = manager.query(new DownloadManager.Query().setFilterById(id));
            if (cursor == null || !cursor.moveToFirst()) return -1;
            int column = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            return column >= 0 ? cursor.getInt(column) : -1;
        } catch (Exception error) {
            android.util.Log.w("VividUpdater", "Could not inspect the active Android update download", error);
            return -1;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private void reconcileDownload(long id) {
        int status = getDownloadStatus(id);
        if (status == DownloadManager.STATUS_SUCCESSFUL) {
            openInstaller(getContext(), id);
        } else if (status == DownloadManager.STATUS_FAILED || status == -1) {
            clearActiveDownload(getContext());
        }
    }

    private void clearActiveDownload(Context context) {
        activeDownload.set(-1);
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .remove(ACTIVE_DOWNLOAD_ID)
            .apply();
    }

    private void openInstaller(Context context, long id) {
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        Uri uri = manager == null ? null : manager.getUriForDownloadedFile(id);
        if (uri == null) return;

        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(uri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            context.startActivity(install);
            clearActiveDownload(context);
        } catch (Exception error) {
            // Keep the download ID persisted. The next app resume can retry after
            // Android has allowed the foreground activity transition.
            android.util.Log.e("VividUpdater", "Could not open Android package installer", error);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://github.com/") || url.startsWith("https://objects.githubusercontent.com/") || url.startsWith("https://release-assets.githubusercontent.com/"))) {
            call.reject("A valid official GitHub APK URL is required.");
            return;
        }

        if (Build.VERSION.SDK_INT >= 26 && !Settings.canRequestPackageInstalls()) {
            try {
                Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
                call.reject("Allow Vivid Cinema to install apps in Android settings, then tap Download & Install again.");
            } catch (Exception error) {
                call.reject("Android could not open the permission needed to install Vivid Cinema updates.", error);
            }
            return;
        }

        try {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("Android download service is unavailable.");
                return;
            }

            long previousId = activeDownload.get();
            if (previousId > 0) {
                int status = getDownloadStatus(previousId);
                if (status == DownloadManager.STATUS_PENDING ||
                    status == DownloadManager.STATUS_RUNNING ||
                    status == DownloadManager.STATUS_PAUSED) {
                    JSObject existing = new JSObject();
                    existing.put("downloadId", previousId);
                    existing.put("message", "The Vivid Cinema update is already downloading.");
                    call.resolve(existing);
                    return;
                }
                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    openInstaller(getContext(), previousId);
                    JSObject ready = new JSObject();
                    ready.put("downloadId", previousId);
                    ready.put("message", "The downloaded update is ready to install.");
                    call.resolve(ready);
                    return;
                }
                clearActiveDownload(getContext());
            }

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Vivid Cinema update");
            request.setDescription("Downloading Vivid Cinema " + call.getString("version", "latest"));
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, "Vivid-Cinema-Update.apk");
            long id = manager.enqueue(request);
            activeDownload.set(id);
            getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putLong(ACTIVE_DOWNLOAD_ID, id)
                .apply();

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

const navigationPlugin = `package com.vividcinema.app;

import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "VividNavigation")
public class VividNavigationPlugin extends Plugin {
    private OnBackPressedCallback backCallback;

    @Override
    public void load() {
        backCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                JSObject data = new JSObject();
                data.put("canGoBack", getBridge().getWebView().canGoBack());
                notifyListeners("backButton", data, true);
            }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), backCallback);
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        call.resolve();
        getActivity().finish();
    }
}
`;
await writeFile(path.join(javaRoot, "VividNavigationPlugin.java"), navigationPlugin, "utf8");

const webChromeClient = `package com.vividcinema.app;

import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient.CustomViewCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Capacitor's default client rejects WebView fullscreen custom views. This
 * subclass keeps all of its permission/dialog/file-picker behavior and adds
 * the native view attachment required by HTML fullscreen and provider video.
 */
public class VividWebChromeClient extends BridgeWebChromeClient {
    private final Bridge bridge;
    private View customView;
    private CustomViewCallback customViewCallback;
    private int originalSystemUiVisibility;
    private int originalWindowFlags;
    private int originalRequestedOrientation;

    public VividWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
        Activity activity = bridge.getActivity();
        if (activity == null || customView != null) {
            if (callback != null) callback.onCustomViewHidden();
            return;
        }

        Window window = activity.getWindow();
        View decorView = window.getDecorView();
        originalSystemUiVisibility = decorView.getSystemUiVisibility();
        originalWindowFlags = window.getAttributes().flags;
        originalRequestedOrientation = activity.getRequestedOrientation();
        customView = view;
        customViewCallback = callback;

        if (view.getParent() instanceof ViewGroup) {
            ((ViewGroup) view.getParent()).removeView(view);
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );
        ((ViewGroup) decorView).addView(
            view,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
    }

    @Override
    public void onHideCustomView() {
        if (customView == null) {
            super.onHideCustomView();
            return;
        }

        Activity activity = bridge.getActivity();
        if (activity != null) {
            Window window = activity.getWindow();
            View decorView = window.getDecorView();
            if (customView.getParent() instanceof ViewGroup) {
                ((ViewGroup) customView.getParent()).removeView(customView);
            }
            if ((originalWindowFlags & WindowManager.LayoutParams.FLAG_FULLSCREEN) != 0) {
                window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }
            decorView.setSystemUiVisibility(originalSystemUiVisibility);
            activity.setRequestedOrientation(originalRequestedOrientation);
        }

        customView = null;
        CustomViewCallback callback = customViewCallback;
        customViewCallback = null;
        if (callback != null) callback.onCustomViewHidden();
        super.onHideCustomView();
    }
}
`;
await writeFile(path.join(javaRoot, "VividWebChromeClient.java"), webChromeClient, "utf8");

const manifestPath = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
let manifest = await readFile(manifestPath, "utf8");
let manifestChanged = false;
for (const permission of [
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS"
]) {
  if (manifest.includes(permission)) continue;
  manifest = manifest.replace(
    /<application\b/,
    `    <uses-permission android:name="${permission}" />\n\n    <application`
  );
  manifestChanged = true;
}
if (!manifest.includes('android.hardware.microphone')) {
  manifest = manifest.replace(
    /<application\b/,
    '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n\n    <application'
  );
  manifestChanged = true;
}
if (manifestChanged) await writeFile(manifestPath, manifest, "utf8");
console.log(`Configured Vivid Android updater plugin (version ${versionName}, build ${buildNumber}, versionCode ${versionCode}).`);
