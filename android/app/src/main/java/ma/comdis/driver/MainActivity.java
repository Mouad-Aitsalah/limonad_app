package ma.comdis.driver;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (non npm) plugin: Bluetooth thermal printer - see ThermalPrinterPlugin.
        // Must be registered before super.onCreate() builds the Capacitor bridge.
        registerPlugin(ThermalPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
