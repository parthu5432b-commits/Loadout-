package __PACKAGE__;

import android.content.pm.PackageInfo;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "LoadoutCore")
public class LoadoutCorePlugin extends Plugin {
    private static final Pattern SAFE = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$");
    private static final int MAX_BYTES = 10 * 1024 * 1024;

    private boolean safe(String value) { return value != null && SAFE.matcher(value).matches() && !".".equals(value) && !"..".equals(value); }

    private File namespaceDir(String namespace) throws Exception {
        if (!safe(namespace)) throw new Exception("Invalid storage namespace");
        File base = new File(getContext().getFilesDir(), "loadout");
        File dir = new File(base, namespace);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create private storage directory");
        String basePath = base.getCanonicalPath() + File.separator;
        if (!dir.getCanonicalPath().startsWith(basePath)) throw new Exception("Storage path escaped private root");
        return dir;
    }

    private File target(String namespace, String key) throws Exception {
        if (!safe(key)) throw new Exception("Invalid storage key");
        File dir = namespaceDir(namespace);
        File file = new File(dir, key);
        if (!file.getCanonicalPath().startsWith(dir.getCanonicalPath() + File.separator)) throw new Exception("Storage path escaped namespace");
        return file;
    }

    @PluginMethod
    public void getRuntimeInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("platform", "android");
        ret.put("androidApi", Build.VERSION.SDK_INT);
        ret.put("androidRelease", Build.VERSION.RELEASE);
        ret.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            ret.put("packageName", getContext().getPackageName());
            ret.put("versionName", info.versionName == null ? "" : info.versionName);
            ret.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
        } catch (Exception ignored) { ret.put("packageName", getContext().getPackageName()); }
        call.resolve(ret);
    }

    @PluginMethod
    public void readPrivateFile(PluginCall call) {
        try {
            String namespace = call.getString("namespace");
            String key = call.getString("key");
            File file = target(namespace, key);
            if (!file.exists()) {
                File backup = new File(file.getParentFile(), file.getName() + ".previous");
                if (backup.exists()) backup.renameTo(file);
            }
            if (!file.exists()) { JSObject result = new JSObject(); result.put("value", (String) null); call.resolve(result); return; }
            if (file.length() > MAX_BYTES) throw new Exception("Stored item exceeds read limit");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (FileInputStream in = new FileInputStream(file)) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            }
            JSObject result = new JSObject();
            result.put("value", new String(out.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception error) { call.reject("Native read failed: " + error.getMessage(), error); }
    }

    @PluginMethod
    public void writePrivateFile(PluginCall call) {
        try {
            String namespace = call.getString("namespace");
            String key = call.getString("key");
            String value = call.getString("value");
            if (value == null) throw new Exception("Missing value");
            byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_BYTES) throw new Exception("Stored item exceeds 10 MiB limit");
            File file = target(namespace, key);
            File recovery = new File(file.getParentFile(), file.getName() + ".previous");
            if (!file.exists() && recovery.exists()) recovery.renameTo(file);
            File temp = new File(file.getParentFile(), file.getName() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(temp)) { out.write(bytes); out.getFD().sync(); }
            File backup = new File(file.getParentFile(), file.getName() + ".previous");
            if (backup.exists() && !backup.delete()) throw new Exception("Could not clear stale storage backup");
            boolean hadPrevious = file.exists();
            if (hadPrevious && !file.renameTo(backup)) throw new Exception("Could not preserve previous storage item");
            if (!temp.renameTo(file)) {
                if (hadPrevious) backup.renameTo(file);
                throw new Exception("Atomic storage activation failed");
            }
            if (backup.exists()) backup.delete();
            JSObject result = new JSObject(); result.put("ok", true); result.put("bytes", bytes.length); call.resolve(result);
        } catch (Exception error) { call.reject("Native write failed: " + error.getMessage(), error); }
    }

    @PluginMethod
    public void deletePrivateFile(PluginCall call) {
        try {
            File file = target(call.getString("namespace"), call.getString("key"));
            File backup = new File(file.getParentFile(), file.getName() + ".previous");
            File temp = new File(file.getParentFile(), file.getName() + ".tmp");
            boolean deleted = (!file.exists() || file.delete()) && (!backup.exists() || backup.delete()) && (!temp.exists() || temp.delete());
            JSObject result = new JSObject(); result.put("ok", deleted); call.resolve(result);
        } catch (Exception error) { call.reject("Native delete failed: " + error.getMessage(), error); }
    }

    @PluginMethod
    public void listPrivateFiles(PluginCall call) {
        try {
            File dir = namespaceDir(call.getString("namespace"));
            JSArray names = new JSArray();
            File[] files = dir.listFiles();
            if (files != null) for (File file : files) if (file.isFile() && safe(file.getName()) && !file.getName().endsWith(".tmp") && !file.getName().endsWith(".previous")) names.put(file.getName());
            JSObject result = new JSObject(); result.put("files", names); call.resolve(result);
        } catch (Exception error) { call.reject("Native list failed: " + error.getMessage(), error); }
    }
}
