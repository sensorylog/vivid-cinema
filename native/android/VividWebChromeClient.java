package com.vividcinema.app;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
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
    private boolean originalStatusBarVisible = true;
    private boolean originalNavigationBarVisible = true;
    private int originalSystemBarsBehavior = WindowInsetsController.BEHAVIOR_DEFAULT;
    private int originalSystemBarsAppearance;

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsets rootInsets = decorView.getRootWindowInsets();
            if (rootInsets != null) {
                originalStatusBarVisible = rootInsets.isVisible(WindowInsets.Type.statusBars());
                originalNavigationBarVisible = rootInsets.isVisible(WindowInsets.Type.navigationBars());
            }
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                originalSystemBarsBehavior = controller.getSystemBarsBehavior();
                originalSystemBarsAppearance = controller.getSystemBarsAppearance();
            }
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
        }
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
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsBehavior(originalSystemBarsBehavior);
                    controller.setSystemBarsAppearance(
                        originalSystemBarsAppearance,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                    );
                    if (originalStatusBarVisible) controller.show(WindowInsets.Type.statusBars());
                    else controller.hide(WindowInsets.Type.statusBars());
                    if (originalNavigationBarVisible) controller.show(WindowInsets.Type.navigationBars());
                    else controller.hide(WindowInsets.Type.navigationBars());
                }
            } else {
                decorView.setSystemUiVisibility(originalSystemUiVisibility);
            }
            activity.setRequestedOrientation(originalRequestedOrientation);
        }

        customView = null;
        CustomViewCallback callback = customViewCallback;
        customViewCallback = null;
        if (callback != null) callback.onCustomViewHidden();
        super.onHideCustomView();
    }
}
