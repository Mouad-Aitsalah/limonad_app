package ma.comdis.driver;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private LaunchSplashOverlay launchSplash;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (non npm) plugin: Bluetooth thermal printer - see ThermalPrinterPlugin.
        // Must be registered before super.onCreate() builds the Capacitor bridge.
        registerPlugin(ThermalPrinterPlugin.class);
        super.onCreate(savedInstanceState);

        // Animated launch screen, only on a real launch (not when Android restores the
        // activity with a saved state). The WebView keeps loading underneath; the
        // overlay leaves when the first page has loaded (or failed) - see LaunchSplashOverlay.
        if (savedInstanceState == null) {
            launchSplash = LaunchSplashOverlay.show(this);
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    contentReady();
                }

                @Override
                public void onReceivedError(WebView webView) {
                    contentReady();
                }
            });
        }
    }

    private void contentReady() {
        if (launchSplash != null) launchSplash.onContentReady();
    }

    @Override
    public void onDestroy() {
        if (launchSplash != null) {
            launchSplash.destroy();
            launchSplash = null;
        }
        super.onDestroy();
    }
}
