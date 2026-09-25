package ma.comdis.driver;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Bluetooth Classic (RFCOMM / SPP) access for 80 mm ESC/POS thermal printers.
 *
 * Deliberately tiny: it lists the devices ALREADY PAIRED in Android's settings
 * (no scan, so no BLUETOOTH_SCAN and no location permission), opens a serial
 * socket to one of them and writes the raw bytes it is given. The ticket, the
 * ESC/POS commands and the choice of printer all live in the web layer
 * (lib/escpos-receipt.ts, lib/thermal-printer.ts), which is why the printing
 * logic can be tested without a phone.
 *
 * Permissions: Android 12+ (API 31): BLUETOOTH_CONNECT, asked at runtime.
 * Android 11 and older: the install-time BLUETOOTH permission is enough.
 *
 * Error codes returned to JavaScript: PERMISSION_DENIED, BT_UNAVAILABLE,
 * BT_DISABLED, NOT_PAIRED, CONNECT_FAILED, WRITE_FAILED, INVALID_ARGUMENT.
 */
@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class ThermalPrinterPlugin extends Plugin {

    /** Serial Port Profile: the UUID every SPP thermal printer listens on. */
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private static final int WRITE_CHUNK = 512;
    private static final long WRITE_PAUSE_MS = 15;
    /** Lets the printer's own buffer drain before anything else touches the socket. */
    private static final long DRAIN_PAUSE_MS = 250;

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private BluetoothSocket socket;
    private String connectedAddress;

    // ------------------------------------------------------------------ helpers

    private BluetoothAdapter adapter() {
        BluetoothManager manager = getContext().getSystemService(BluetoothManager.class);
        return manager == null ? null : manager.getAdapter();
    }

    private boolean hasPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** Rejects the call and returns false when Bluetooth cannot be used right now. */
    @SuppressLint("MissingPermission")
    private boolean requireBluetooth(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("Cet appareil n'a pas de Bluetooth.", "BT_UNAVAILABLE");
            return false;
        }
        if (!hasPermission()) {
            call.reject("Autorisation Bluetooth refusée.", "PERMISSION_DENIED");
            return false;
        }
        if (!adapter.isEnabled()) {
            call.reject("Le Bluetooth est désactivé.", "BT_DISABLED");
            return false;
        }
        return true;
    }

    private synchronized void closeSocket() {
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {
                // nothing left to do
            }
        }
        socket = null;
        connectedAddress = null;
    }

    private synchronized boolean isConnectedTo(String address) {
        return socket != null && socket.isConnected() && address.equalsIgnoreCase(connectedAddress);
    }

    /** Opens (or reuses) the socket to a PAIRED device. Blocking: run off the main thread. */
    @SuppressLint("MissingPermission")
    private synchronized void ensureConnected(String address) throws PrinterException {
        if (isConnectedTo(address)) return;
        closeSocket();

        BluetoothAdapter adapter = adapter();
        if (adapter == null) throw new PrinterException("BT_UNAVAILABLE", "Bluetooth indisponible.");
        BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(address);
        } catch (IllegalArgumentException e) {
            throw new PrinterException("NOT_PAIRED", "Adresse Bluetooth invalide.");
        }
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded == null || !bonded.contains(device)) {
            throw new PrinterException("NOT_PAIRED", "L'imprimante n'est pas appairée.");
        }

        // No discovery is running (we never scan), so no cancelDiscovery() is needed.
        IOException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            BluetoothSocket candidate = null;
            try {
                if (attempt == 0) {
                    candidate = device.createRfcommSocketToServiceRecord(SPP_UUID);
                } else if (attempt == 1) {
                    candidate = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                } else {
                    // Some inexpensive printers only answer on RFCOMM channel 1.
                    candidate = (BluetoothSocket) device.getClass()
                        .getMethod("createRfcommSocket", int.class)
                        .invoke(device, 1);
                }
                candidate.connect();
                socket = candidate;
                connectedAddress = address;
                return;
            } catch (IOException e) {
                last = e;
                if (candidate != null) {
                    try {
                        candidate.close();
                    } catch (IOException ignored) {
                        // ignore
                    }
                }
            } catch (Exception e) {
                last = new IOException(e.getMessage());
            }
        }
        throw new PrinterException("CONNECT_FAILED", last == null ? "Connexion impossible." : String.valueOf(last.getMessage()));
    }

    private synchronized void write(byte[] data) throws IOException {
        OutputStream out = socket.getOutputStream();
        for (int offset = 0; offset < data.length; offset += WRITE_CHUNK) {
            int length = Math.min(WRITE_CHUNK, data.length - offset);
            out.write(data, offset, length);
            out.flush();
            try {
                Thread.sleep(WRITE_PAUSE_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrompu");
            }
        }
        try {
            Thread.sleep(DRAIN_PAUSE_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static class PrinterException extends Exception {
        final String code;

        PrinterException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    // ------------------------------------------------------------------ methods

    @PluginMethod
    public void getStatus(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        JSObject result = new JSObject();
        result.put("bluetoothSupported", adapter != null);
        result.put("bluetoothEnabled", adapter != null && hasPermission() && adapter.isEnabled());
        result.put("permissionGranted", hasPermission());
        result.put("sdkInt", Build.VERSION.SDK_INT);
        synchronized (this) {
            result.put("connectedAddress", isConnectedTo(connectedAddress == null ? "" : connectedAddress) ? connectedAddress : null);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void requestBluetoothPermission(PluginCall call) {
        if (hasPermission()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback");
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasPermission());
        call.resolve(result);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void listPairedPrinters(PluginCall call) {
        if (!requireBluetooth(call)) return;
        BluetoothAdapter adapter = adapter();
        JSArray printers = new JSArray();
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice device : bonded) {
                JSObject item = new JSObject();
                String name = device.getName();
                item.put("name", name == null || name.isEmpty() ? device.getAddress() : name);
                item.put("address", device.getAddress());
                BluetoothClass deviceClass = device.getBluetoothClass();
                item.put("printerLike", deviceClass != null && deviceClass.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING);
                printers.put(item);
            }
        }
        JSObject result = new JSObject();
        result.put("printers", printers);
        synchronized (this) {
            result.put("connectedAddress", isConnectedTo(connectedAddress == null ? "" : connectedAddress) ? connectedAddress : null);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void connect(final PluginCall call) {
        final String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Adresse manquante.", "INVALID_ARGUMENT");
            return;
        }
        if (!requireBluetooth(call)) return;
        io.execute(() -> {
            try {
                ensureConnected(address);
                JSObject result = new JSObject();
                result.put("connected", true);
                call.resolve(result);
            } catch (PrinterException e) {
                call.reject(e.getMessage(), e.code);
            }
        });
    }

    @PluginMethod
    public void disconnect(final PluginCall call) {
        io.execute(() -> {
            closeSocket();
            call.resolve();
        });
    }

    @PluginMethod
    public void print(final PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || address.isEmpty() || data == null || data.isEmpty()) {
            call.reject("Adresse ou données manquantes.", "INVALID_ARGUMENT");
            return;
        }
        if (!requireBluetooth(call)) return;

        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Données invalides.", "INVALID_ARGUMENT");
            return;
        }

        io.execute(() -> {
            try {
                ensureConnected(address);
                try {
                    write(bytes);
                } catch (IOException first) {
                    // The printer may have gone to sleep since the last ticket: reconnect once.
                    closeSocket();
                    ensureConnected(address);
                    write(bytes);
                }
                JSObject result = new JSObject();
                result.put("bytesWritten", bytes.length);
                call.resolve(result);
            } catch (PrinterException e) {
                call.reject(e.getMessage(), e.code);
            } catch (IOException e) {
                closeSocket();
                call.reject(String.valueOf(e.getMessage()), "WRITE_FAILED");
            }
        });
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        closeSocket();
        io.shutdown();
    }
}
