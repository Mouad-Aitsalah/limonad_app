package ma.comdis.driver;

import android.annotation.SuppressLint;
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;

/**
 * Lays its children out on a fixed "artboard" (in the source illustration's own
 * pixels) scaled uniformly to the available width - so the cut-out layers of the
 * launch illustration always sit exactly where they were in the original image,
 * on every screen size, without ever being stretched (one scale factor for both
 * axes).
 *
 * Measured with WRAP_CONTENT: as wide as allowed (capped by maxWidth), the height
 * following the artboard's ratio, both reduced together if maxHeight is reached.
 * With an EXACT size on both axes (a nested artboard), that size is used as is.
 *
 * Only built in code (LaunchSplashOverlay), never inflated from XML - hence no
 * (Context, AttributeSet) constructor.
 */
@SuppressLint("ViewConstructor")
final class ArtboardLayout extends ViewGroup {

    /** Position of a child on the artboard, in artboard units. */
    static final class Params extends ViewGroup.LayoutParams {
        final float left;
        final float top;
        final float width;
        final float height;

        Params(float left, float top, float width, float height) {
            super(0, 0);
            this.left = left;
            this.top = top;
            this.width = width;
            this.height = height;
        }
    }

    private final float artWidth;
    private final float artHeight;
    private int maxWidth = Integer.MAX_VALUE;
    private int maxHeight = Integer.MAX_VALUE;

    ArtboardLayout(Context context, float artWidth, float artHeight) {
        super(context);
        this.artWidth = artWidth;
        this.artHeight = artHeight;
        // The truck starts outside the artboard: it must not be clipped by it.
        setClipChildren(false);
        setClipToPadding(false);
    }

    void setMaxSize(int maxWidth, int maxHeight) {
        this.maxWidth = maxWidth;
        this.maxHeight = maxHeight;
        requestLayout();
    }

    /** Pixels per artboard unit (valid after layout). */
    float scale() {
        return getWidth() / artWidth;
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int widthMode = MeasureSpec.getMode(widthMeasureSpec);
        int heightMode = MeasureSpec.getMode(heightMeasureSpec);
        int width;
        int height;
        if (widthMode == MeasureSpec.EXACTLY && heightMode == MeasureSpec.EXACTLY) {
            width = MeasureSpec.getSize(widthMeasureSpec);
            height = MeasureSpec.getSize(heightMeasureSpec);
        } else {
            float w = widthMode == MeasureSpec.UNSPECIFIED ? artWidth : MeasureSpec.getSize(widthMeasureSpec);
            w = Math.min(w, maxWidth);
            float h = w * artHeight / artWidth;
            float heightLimit = maxHeight;
            if (heightMode != MeasureSpec.UNSPECIFIED) heightLimit = Math.min(heightLimit, MeasureSpec.getSize(heightMeasureSpec));
            if (h > heightLimit) {
                h = heightLimit;
                w = h * artWidth / artHeight;
            }
            width = Math.round(w);
            height = Math.round(h);
        }
        setMeasuredDimension(width, height);

        float scale = width / artWidth;
        for (int i = 0; i < getChildCount(); i++) {
            View child = getChildAt(i);
            Params params = (Params) child.getLayoutParams();
            child.measure(
                MeasureSpec.makeMeasureSpec(Math.round(params.width * scale), MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(Math.round(params.height * scale), MeasureSpec.EXACTLY)
            );
        }
    }

    @Override
    protected void onLayout(boolean changed, int l, int t, int r, int b) {
        float scale = (r - l) / artWidth;
        for (int i = 0; i < getChildCount(); i++) {
            View child = getChildAt(i);
            Params params = (Params) child.getLayoutParams();
            int left = Math.round(params.left * scale);
            int top = Math.round(params.top * scale);
            child.layout(left, top, left + child.getMeasuredWidth(), top + child.getMeasuredHeight());
        }
    }

    @Override
    protected boolean checkLayoutParams(ViewGroup.LayoutParams p) {
        return p instanceof Params;
    }
}
