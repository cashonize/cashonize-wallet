package com.cashonize.wallet;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The app lock's fingerprint or face prompt (src/utils/biometrics.ts). A gate in the interface
// like the PIN: it reports whether the device's owner passed the prompt, and unlocks no key.
@CapacitorPlugin(name = "Biometric")
public class BiometricPlugin extends Plugin {

    // Android's strong class only: a weak face unlock from a camera image does not pass, and
    // neither does the device's own PIN or pattern
    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        int status = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        JSObject result = new JSObject();
        result.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(result);
    }

    // Resolves { verified } once the prompt closes: true when passed, false for every other way
    // it ends (the cancel button, back, too many tries, a lockout, the app going to the background)
    @PluginMethod
    public void verify(PluginCall call) {
        String title = call.getString("title", "");
        String cancel = call.getString("cancel", "");
        getActivity().runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setNegativeButtonText(cancel)
                .setAllowedAuthenticators(AUTHENTICATORS)
                .setConfirmationRequired(false)
                .build();
            BiometricPrompt prompt = new BiometricPrompt(
                getActivity(),
                ContextCompat.getMainExecutor(getContext()),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult authResult) {
                        resolveVerified(call, true);
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence message) {
                        resolveVerified(call, false);
                    }
                    // onAuthenticationFailed is a finger or face not recognised: the prompt
                    // stays open for another try and ends in one of the two callbacks above
                }
            );
            prompt.authenticate(info);
        });
    }

    private static void resolveVerified(PluginCall call, boolean verified) {
        JSObject result = new JSObject();
        result.put("verified", verified);
        call.resolve(result);
    }
}
