package com.cashonize.wallet;

import android.content.res.Configuration;
import android.graphics.Color;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Paints the window behind the WebView in the app theme's background colour (src/boot/systemBars.ts):
// where Capacitor pads the page clear of the system bars (an older WebView), the window shows behind them
@CapacitorPlugin(name = "WindowBackground")
public class WindowBackgroundPlugin extends Plugin {

    private Integer color;

    @PluginMethod
    public void setColor(PluginCall call) {
        String hex = call.getString("color", "");
        // CSS allows the short "#fff", Android's parser does not
        if (hex.length() == 4) hex = hex.replaceAll("([0-9a-fA-F])", "$1$1");
        int parsed;
        try {
            parsed = Color.parseColor(hex);
        } catch (RuntimeException error) {
            call.reject("not a colour");
            return;
        }
        getActivity().runOnUiThread(() -> {
            color = parsed;
            applyColor();
            call.resolve();
        });
    }

    // Capacitor's SystemBars plugin repaints the window in the phone theme's colour on every
    // configuration change (a rotation, the phone turning dark); posted, so this runs after it
    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);
        getActivity().getWindow().getDecorView().post(this::applyColor);
    }

    private void applyColor() {
        if (color != null) getActivity().getWindow().getDecorView().setBackgroundColor(color);
    }
}
