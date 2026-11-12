package co.za.kauafragrances.admin;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Device helpers for the back office:
 *  - volume keys as a hardware scan trigger (like a rugged handheld's side button)
 *  - send a file straight into a specific WhatsApp chat
 */
@CapacitorPlugin(name = "KfDevice")
public class KfDevicePlugin extends Plugin {

    static KfDevicePlugin instance;
    private volatile boolean triggerEnabled = false;

    @Override
    public void load() {
        instance = this;
    }

    /**
     * Called by MainActivity for every volume key event while enabled. Sends
     * "press" on the first key-down and "release" on key-up, so the app can act
     * like a handheld trigger: hold to scan, let go to stop.
     */
    boolean onTriggerKey(int keyCode, boolean press, boolean release) {
        if (!triggerEnabled) return false;
        if (press || release) {
            JSObject data = new JSObject();
            data.put("key", keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down");
            data.put("action", press ? "press" : "release");
            notifyListeners("trigger", data);
        }
        return true; // swallow the key so the volume doesn't change
    }

    @PluginMethod
    public void setTriggerEnabled(PluginCall call) {
        triggerEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    private boolean installed(String pkg) {
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /**
     * Opens WhatsApp directly on the customer's chat with the PDF attached.
     * phone: international digits only, e.g. 27821234567.
     */
    @PluginMethod
    public void shareToWhatsApp(PluginCall call) {
        String path = call.getString("path");
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        if (path == null) { call.reject("path required"); return; }

        String pkg = installed("com.whatsapp") ? "com.whatsapp" : installed("com.whatsapp.w4b") ? "com.whatsapp.w4b" : null;
        if (pkg == null) { call.reject("WhatsApp is not installed", "NO_WHATSAPP"); return; }

        try {
            File file = new File(Uri.parse(path).getPath());
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("application/pdf");
            intent.setPackage(pkg);
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            if (!text.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text);
            String digits = phone.replaceAll("[^0-9]", "");
            if (!digits.isEmpty()) intent.putExtra("jid", digits + "@s.whatsapp.net");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("WhatsApp is not installed", "NO_WHATSAPP");
        } catch (Exception e) {
            call.reject("Could not open WhatsApp: " + e.getMessage());
        }
    }
}
