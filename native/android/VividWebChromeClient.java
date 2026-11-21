package com.vividcinema.app;

import android.app.Activity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient.CustomViewCallback;
import java.lang.ref.WeakReference;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Capacitor's default client rejects WebView fullscreen custom views. This
 * subclass keeps all of its permission/dialog/file-picker behavior and adds
 * the native view attachment required by HTML fullscreen and provider video.
 */
public class VividWebChromeClient extends BridgeWebChromeClient {
    private static WeakReference<VividWebChromeClient> activeClient = new WeakReference<>(null);
    private final Bridge bridge;
    private View customView;
    private CustomViewCallback customViewCallback;
    private int originalSystemUiVisibility;
    private int originalWindowFlags;
    private int originalRequestedOrientation;

    public VividWebChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        activeClient = new WeakReference<>(this);
    }

    /** Exits the currently displayed WebView fullscreen custom view on Android Back. */
    public static boolean exitActiveCustomView() {
        VividWebChromeClient client = activeClient.get();
        if (client == null || client.customView == null) return false;
        client.onHideCustomView();
        return true;
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
