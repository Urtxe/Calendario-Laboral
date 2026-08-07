/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package es.balancelaboral.app;

import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;



public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    // The web app uses this marker only to hide Premium commerce in the Play TWA.
    // It is not an authentication or entitlement signal.
    private static final String PLAY_TWA_CONTEXT_PARAM = "play_twa";
    private static final String PLAY_TWA_CONTEXT_VALUE = "1";
    private static final String TRUSTED_HOST = "balancelaboral.es";
    

    

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Bubblewrap resolves both the launcher URL and verified deep links here.
        Uri uri = super.getLaunchingUrl();

        // Mark only internal HTTPS navigations. This preserves the package, origin,
        // asset links and the original deep-link path/query parameters.
        if (uri == null
                || !"https".equals(uri.getScheme())
                || !TRUSTED_HOST.equals(uri.getHost())
                || PLAY_TWA_CONTEXT_VALUE.equals(uri.getQueryParameter(PLAY_TWA_CONTEXT_PARAM))) {
            return uri;
        }

        return uri.buildUpon()
                .appendQueryParameter(PLAY_TWA_CONTEXT_PARAM, PLAY_TWA_CONTEXT_VALUE)
                .build();
    }
}
