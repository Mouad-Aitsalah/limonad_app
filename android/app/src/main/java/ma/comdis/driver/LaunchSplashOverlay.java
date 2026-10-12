package ma.comdis.driver;

import android.animation.Animator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * Animated launch screen of the driver APK, drawn natively ABOVE the Capacitor
 * WebView - so it works the same in REMOTE mode (Vercel) and LOCAL mode
 * (embedded shell), with or without network, and the web app is not touched.
 *
 * Shown once per real launch (MainActivity.onCreate without a saved state),
 * never on a page change or when the POS opens. It does not delay anything: the
 * WebView keeps loading underneath, and the overlay goes away as soon as the page
 * has loaded AND the short animation has played (MIN_VISIBLE_MS), and in any case
 * after MAX_VISIBLE_MS - a slow or missing network never keeps the driver on it.
 *
 * The illustration is the supplied image cut into layers by
 * scripts/generate-driver-splash-assets.mjs (truck, driver, one disc per wheel);
 * the rectangles below are that script's, in source pixels.
 */
final class LaunchSplashOverlay {

    static final long MIN_VISIBLE_MS = 1800;
    static final long MAX_VISIBLE_MS = 2800;
    private static final long EXIT_MS = 260;
    /** If the overlay were never drawn at all, it must still never stay. */
    private static final long BACKSTOP_MS = 10_000;

    // Artboard = the part of the 1536x1024 source that holds the drawing (+ 4 px margin).
    private static final float ART_LEFT = 56f;
    private static final float ART_TOP = 166f;
    private static final float ART_WIDTH = 1432f;
    private static final float ART_HEIGHT = 744f;

    // Layers, in source pixels: {left, top, width, height}.
    private static final float[] TRUCK = {60f, 170f, 1080f, 677f};
    private static final float[] DRIVER = {1100f, 250f, 385f, 657f};
    private static final float[] WHEEL_FRONT = {229f, 631f, 168f, 168f};
    private static final float[] WHEEL_REAR = {838f, 632f, 168f, 168f};
    // Axle inside each wheel crop (the rotation pivot) and the tyre's rolling radius.
    private static final float[] WHEEL_FRONT_AXLE = {83.7f, 83.9f};
    private static final float[] WHEEL_REAR_AXLE = {84.0f, 83.5f};
    private static final float TYRE_RADIUS = 96f;

    private static final long TRUCK_MS = 1000;
    private static final long DRIVER_DELAY_MS = 780;
    private static final long DRIVER_MS = 460;
    private static final long TITLE_DELAY_MS = 1000;
    private static final long SUBTITLE_DELAY_MS = 1120;
    private static final long TEXT_MS = 380;
    private static final long DOTS_DELAY_MS = 1250;

    private final Activity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Animator> animators = new ArrayList<>();
    private final boolean motion;
    private long startedAt = -1;
    private boolean contentReady;

    // System bars as the app had them, restored when the overlay leaves.
    private int savedStatusBarColor;
    private int savedNavigationBarColor;
    private boolean savedLightStatusBars;
    private boolean savedLightNavigationBars;
    private boolean barsChanged;

    private FrameLayout root;
    private ArtboardLayout artboard;
    private ArtboardLayout truck;
    private ImageView wheelFront;
    private ImageView wheelRear;
    private ImageView driver;
    private TextView title;
    private TextView subtitle;
    private LinearLayout dots;
    private boolean dismissed;

    private LaunchSplashOverlay(Activity activity) {
        this.activity = activity;
        this.motion = animationsEnabled(activity);
    }

    /** Adds the overlay on top of the activity's content and starts the animation. */
    static LaunchSplashOverlay show(Activity activity) {
        LaunchSplashOverlay overlay = new LaunchSplashOverlay(activity);
        overlay.build();
        overlay.root.post(overlay::start);
        // Backstop only: the real limits count from the first frame (see start()).
        overlay.handler.postDelayed(overlay::dismiss, BACKSTOP_MS);
        return overlay;
    }

    /** The app's first page has loaded (or failed): leave once the animation has played. */
    void onContentReady() {
        handler.post(() -> {
            contentReady = true;
            scheduleEarlyDismiss();
        });
    }

    /**
     * MIN/MAX count from the moment the overlay is actually on screen - not from
     * onCreate: on a slow phone the first frame can come late, and the animation
     * must still be seen, never cut or skipped.
     */
    private void scheduleEarlyDismiss() {
        if (dismissed || !contentReady || startedAt < 0) return;
        long elapsed = SystemClock.uptimeMillis() - startedAt;
        handler.postDelayed(this::dismiss, Math.max(0, MIN_VISIBLE_MS - elapsed));
    }

    /** Activity destroyed: drop everything at once. */
    void destroy() {
        dismissed = true;
        handler.removeCallbacksAndMessages(null);
        remove();
    }

    // ------------------------------------------------------------------ build

    private void build() {
        int background = ContextCompat.getColor(activity, R.color.splash_background);

        root = new FrameLayout(activity);
        root.setBackgroundColor(background);
        root.setClickable(true); // the WebView underneath gets no stray tap during the animation
        root.setClipChildren(false);
        root.setContentDescription(activity.getString(R.string.splash_content_description));

        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        column.setClipChildren(false);
        column.setClipToPadding(false);
        column.setPadding(dp(24), 0, dp(24), dp(40));
        column.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);

        artboard = new ArtboardLayout(activity, ART_WIDTH, ART_HEIGHT);
        int screenWidth = activity.getResources().getDisplayMetrics().widthPixels;
        int screenHeight = activity.getResources().getDisplayMetrics().heightPixels;
        artboard.setMaxSize(Math.min(screenWidth - dp(48), dp(520)), Math.round(screenHeight * 0.4f));

        truck = new ArtboardLayout(activity, TRUCK[2], TRUCK[3]);
        truck.addView(image(R.drawable.splash_truck), new ArtboardLayout.Params(0f, 0f, TRUCK[2], TRUCK[3]));
        wheelFront = image(R.drawable.splash_wheel_front);
        wheelRear = image(R.drawable.splash_wheel_rear);
        truck.addView(wheelFront, inTruck(WHEEL_FRONT));
        truck.addView(wheelRear, inTruck(WHEEL_REAR));
        artboard.addView(truck, onArtboard(TRUCK));

        driver = image(R.drawable.splash_driver);
        artboard.addView(driver, onArtboard(DRIVER));
        column.addView(artboard, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        title = new TextView(activity);
        title.setText(R.string.splash_title);
        title.setTextColor(ContextCompat.getColor(activity, R.color.splash_navy));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        title.setLetterSpacing(0.12f);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleParams.topMargin = dp(28);
        column.addView(title, titleParams);

        subtitle = new TextView(activity);
        subtitle.setText(R.string.splash_subtitle);
        subtitle.setTextColor(ContextCompat.getColor(activity, R.color.splash_grey));
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subtitleParams.topMargin = dp(6);
        column.addView(subtitle, subtitleParams);

        dots = new LinearLayout(activity);
        dots.setOrientation(LinearLayout.HORIZONTAL);
        int orange = ContextCompat.getColor(activity, R.color.splash_orange);
        for (int i = 0; i < 3; i++) {
            View dot = new View(activity);
            GradientDrawable shape = new GradientDrawable();
            shape.setShape(GradientDrawable.OVAL);
            shape.setColor(orange);
            dot.setBackground(shape);
            LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(7), dp(7));
            if (i > 0) dotParams.leftMargin = dp(8);
            dots.addView(dot, dotParams);
        }
        LinearLayout.LayoutParams dotsParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        dotsParams.topMargin = dp(24);
        column.addView(dots, dotsParams);

        root.addView(column, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));

        if (motion) {
            // Initial state of the timeline (set before the first frame: nothing flashes).
            driver.setAlpha(0f);
            title.setAlpha(0f);
            subtitle.setAlpha(0f);
            dots.setAlpha(0f);
            truck.setAlpha(0f); // made visible by start(), once its off-screen position is known
        }

        activity.addContentView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        paintSystemBars(background);
    }

    /** Status and navigation bars in the splash background (dark icons) while it is shown. */
    @SuppressWarnings("deprecation") // setStatusBarColor: ignored on Android 15+ edge-to-edge, where the overlay is drawn behind the bars anyway
    private void paintSystemBars(int color) {
        Window window = activity.getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        savedStatusBarColor = window.getStatusBarColor();
        savedNavigationBarColor = window.getNavigationBarColor();
        savedLightStatusBars = controller.isAppearanceLightStatusBars();
        savedLightNavigationBars = controller.isAppearanceLightNavigationBars();
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
        barsChanged = true;
    }

    @SuppressWarnings("deprecation")
    private void restoreSystemBars() {
        if (!barsChanged) return;
        barsChanged = false;
        Window window = activity.getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        window.setStatusBarColor(savedStatusBarColor);
        window.setNavigationBarColor(savedNavigationBarColor);
        controller.setAppearanceLightStatusBars(savedLightStatusBars);
        controller.setAppearanceLightNavigationBars(savedLightNavigationBars);
    }

    // -------------------------------------------------------------- animation

    private void start() {
        if (dismissed) return;
        startedAt = SystemClock.uptimeMillis();
        handler.postDelayed(this::dismiss, MAX_VISIBLE_MS);
        scheduleEarlyDismiss();
        if (!motion) return;

        // The truck comes from just outside the left edge of the screen to its place.
        int[] truckOnScreen = new int[2];
        int[] rootOnScreen = new int[2];
        truck.getLocationInWindow(truckOnScreen);
        root.getLocationInWindow(rootOnScreen);
        final float startX = -((truckOnScreen[0] - rootOnScreen[0]) + truck.getWidth() + dp(12));
        final float rollingRadius = TYRE_RADIUS * truck.scale();
        pivot(wheelFront, WHEEL_FRONT_AXLE);
        pivot(wheelRear, WHEEL_REAR_AXLE);
        truck.setTranslationX(startX);
        truck.setAlpha(1f);

        // Gentle start, smooth stop. The wheels roll with the distance actually covered
        // (angle = distance / radius), so they are back to their exact original angle
        // when the truck stops - the still image is then identical to the source.
        ValueAnimator arrival = ValueAnimator.ofFloat(0f, 1f);
        arrival.setDuration(TRUCK_MS);
        arrival.setInterpolator(new PathInterpolator(0.42f, 0f, 0.18f, 1f));
        arrival.addUpdateListener(animation -> {
            float fraction = (float) animation.getAnimatedValue();
            float x = startX * (1f - fraction);
            truck.setTranslationX(x);
            float degrees = (float) Math.toDegrees(x / rollingRadius);
            wheelFront.setRotation(degrees);
            wheelRear.setRotation(degrees);
        });
        play(arrival, 0);

        driver.setTranslationY(dp(10));
        fadeUp(driver, DRIVER_DELAY_MS, DRIVER_MS);
        title.setTranslationY(dp(6));
        fadeUp(title, TITLE_DELAY_MS, TEXT_MS);
        subtitle.setTranslationY(dp(6));
        fadeUp(subtitle, SUBTITLE_DELAY_MS, TEXT_MS);

        ValueAnimator dotsIn = ValueAnimator.ofFloat(0f, 1f);
        dotsIn.setDuration(260);
        dotsIn.addUpdateListener(animation -> dots.setAlpha((float) animation.getAnimatedValue()));
        play(dotsIn, DOTS_DELAY_MS);
        for (int i = 0; i < dots.getChildCount(); i++) {
            final View dot = dots.getChildAt(i);
            dot.setAlpha(0.3f);
            ValueAnimator pulse = ValueAnimator.ofFloat(0.3f, 1f);
            pulse.setDuration(450);
            pulse.setRepeatCount(ValueAnimator.INFINITE);
            pulse.setRepeatMode(ValueAnimator.REVERSE);
            pulse.addUpdateListener(animation -> dot.setAlpha((float) animation.getAnimatedValue()));
            play(pulse, DOTS_DELAY_MS + i * 150L);
        }
    }

    private void fadeUp(final View view, long delay, long duration) {
        final float fromY = view.getTranslationY();
        ValueAnimator animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(duration);
        animator.setInterpolator(new DecelerateInterpolator());
        animator.addUpdateListener(animation -> {
            float fraction = (float) animation.getAnimatedValue();
            view.setAlpha(fraction);
            view.setTranslationY(fromY * (1f - fraction));
        });
        play(animator, delay);
    }

    private void play(Animator animator, long delay) {
        animator.setStartDelay(delay);
        animators.add(animator);
        animator.start();
    }

    // ---------------------------------------------------------------- dismiss

    private void dismiss() {
        if (dismissed) return;
        dismissed = true;
        handler.removeCallbacksAndMessages(null);
        if (root == null) return;
        root.setClickable(false);
        root.animate().alpha(0f).setDuration(EXIT_MS).withEndAction(this::remove).start();
    }

    private void remove() {
        for (Animator animator : animators) animator.cancel();
        animators.clear();
        restoreSystemBars();
        if (root == null) return;
        root.animate().cancel();
        ViewGroup parent = (ViewGroup) root.getParent();
        if (parent != null) parent.removeView(root);
        root = null;
        artboard = null;
        truck = null;
        wheelFront = null;
        wheelRear = null;
        driver = null;
        title = null;
        subtitle = null;
        dots = null;
    }

    // ---------------------------------------------------------------- helpers

    private ImageView image(int resId) {
        ImageView view = new ImageView(activity);
        view.setImageResource(resId);
        // Each layer's box has exactly the layer's ratio (ArtboardLayout), so FIT_XY never distorts it.
        view.setScaleType(ImageView.ScaleType.FIT_XY);
        return view;
    }

    private static ArtboardLayout.Params onArtboard(float[] rect) {
        return new ArtboardLayout.Params(rect[0] - ART_LEFT, rect[1] - ART_TOP, rect[2], rect[3]);
    }

    private static ArtboardLayout.Params inTruck(float[] rect) {
        return new ArtboardLayout.Params(rect[0] - TRUCK[0], rect[1] - TRUCK[1], rect[2], rect[3]);
    }

    private static void pivot(View wheel, float[] axle) {
        wheel.setPivotX(axle[0] / WHEEL_FRONT[2] * wheel.getWidth());
        wheel.setPivotY(axle[1] / WHEEL_FRONT[3] * wheel.getHeight());
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, activity.getResources().getDisplayMetrics()));
    }

    /** False when the user turned animations off (accessibility): the screen is then shown still. */
    private static boolean animationsEnabled(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) return ValueAnimator.areAnimatorsEnabled();
        return Settings.Global.getFloat(activity.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f;
    }
}
