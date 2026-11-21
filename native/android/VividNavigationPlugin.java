package com.vividcinema.app;

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
