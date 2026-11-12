package co.za.kauafragrances.admin;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KfDevicePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Volume keys double as the scan trigger while the scanner asks for it. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if ((code == KeyEvent.KEYCODE_VOLUME_DOWN || code == KeyEvent.KEYCODE_VOLUME_UP)
                && KfDevicePlugin.instance != null) {
            boolean press = event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0;
            boolean release = event.getAction() == KeyEvent.ACTION_UP;
            if (KfDevicePlugin.instance.onTriggerKey(code, press, release)) return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
