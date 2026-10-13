package io.github.vedantx.atlas;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

// ATLAS for Android: the live site (vedant-x.github.io/ATLAS) in a full-screen WebView, so it always
// shows the latest build. The page talks to the app through window.AtlasAndroid for the one thing a
// WebView lacks: system notifications for live alerts.
public class MainActivity extends Activity {
    static final String HOME = "https://vedant-x.github.io/ATLAS/";
    static final String HOST = "vedant-x.github.io";
    static final String PATH = "/ATLAS";
    static final String CHANNEL = "live";
    static final String EXTRA_HASH = "hash";
    static final int BG = 0xff040406;

    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("atlas", MODE_PRIVATE);
        createChannel();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 15+ draws apps edge to edge: keep the page clear of the status bar, the navigation
        // bar, camera cutouts and the keyboard.
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, in) -> {
                Insets i = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " AtlasApp/" + version());
        web.addJavascriptInterface(new Bridge(), "AtlasAndroid");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isAtlas(u)) return false;
                openOutside(u);
                return true;
            }
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        if (state != null && web.restoreState(state) != null) return;
        web.loadUrl(target(getIntent()));
    }

    static boolean isAtlas(Uri u) {
        return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith(PATH);
    }

    // The page to open: a notification's match, an ATLAS link, or the home page.
    String target(Intent intent) {
        if (intent == null) return HOME;
        String hash = intent.getStringExtra(EXTRA_HASH);
        if (hash != null && hash.startsWith("#/")) return HOME + hash;
        Uri data = intent.getData();
        if (isAtlas(data)) return data.toString();
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String hash = intent.getStringExtra(EXTRA_HASH);
        if (hash != null && hash.startsWith("#/")) {
            web.evaluateJavascript("location.hash = " + jsString(hash) + ";", null);
        } else if (isAtlas(intent.getData())) {
            web.loadUrl(intent.getData().toString());
        }
    }

    void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
            // nothing can open it
        }
    }

    // Back closes the open panel or goes to the previous page; on the first page the app goes to the
    // background (still running, so live alerts keep coming) instead of closing.
    void back() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        // Notification permission may have been changed in Android settings meanwhile.
        permissionChanged();
    }

    @Override
    protected void onPause() {
        web.onPause(); // pauses animations only: JavaScript keeps running for live alerts
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "1";
        }
    }

    // ---------- notifications ----------

    void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(getString(R.string.channel_desc));
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] {0, 90, 50, 90});
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    // The web Notification.permission values: granted, denied, or default (not asked yet).
    String permission() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            boolean asked = prefs.getBoolean("asked", false);
            return !asked || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) ? "default" : "denied";
        }
        return nm.areNotificationsEnabled() ? "granted" : "denied";
    }

    void requestPermission() {
        if (Build.VERSION.SDK_INT >= 33 && "default".equals(permission())) {
            prefs.edit().putBoolean("asked", true).apply();
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
        } else {
            permissionChanged();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        permissionChanged();
    }

    void permissionChanged() {
        if (web != null) web.evaluateJavascript("dispatchEvent(new Event('atlas-permission'));", null);
    }

    void show(String title, String body, String tag, String hash) {
        if (!"granted".equals(permission())) return;
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (hash != null && hash.startsWith("#/")) open.putExtra(EXTRA_HASH, hash);
        String key = tag == null || tag.isEmpty() ? String.valueOf(System.currentTimeMillis()) : tag;
        PendingIntent pi = PendingIntent.getActivity(this, key.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : legacyBuilder();
        b.setSmallIcon(R.drawable.ic_badge)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setColor(0xffd2ff00)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setCategory(Notification.CATEGORY_EVENT);
        getSystemService(NotificationManager.class).notify(key, 1, b.build());
    }

    @SuppressWarnings("deprecation")
    Notification.Builder legacyBuilder() {
        return new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH).setVibrate(new long[] {0, 90, 50, 90});
    }

    static String jsString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    // window.AtlasAndroid in the page (called on a WebView thread).
    class Bridge {
        @JavascriptInterface
        public String permission() {
            return MainActivity.this.permission();
        }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(MainActivity.this::requestPermission);
        }

        @JavascriptInterface
        public void show(String title, String body, String tag, String hash) {
            runOnUiThread(() -> MainActivity.this.show(title, body, tag, hash));
        }
    }
}
