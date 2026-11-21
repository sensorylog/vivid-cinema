package com.vividcinema.app;

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
