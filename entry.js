import { ConnectionManagerRequestService } from '../../shared.js';

// Load the existing extension first, then add the user-configurable translation
// output cap as a thin outer wrapper. This keeps provider/profile behavior in
// guard.js untouched.
await import('./guard.js');

const MODULE_NAME = 'inputTranslator';
const TRANSLATION_MARKER = 'You are a skilled Korean-to-English literary translator.';
const TOKEN_SETTING_KEY = 'maxTranslationTokens';
const DEFAULT_TRANSLATION_TOKENS = 4096;
const MIN_TRANSLATION_TOKENS = 256;
const MAX_TRANSLATION_TOKENS = 32768;

function getExtensionSettings() {
    const context = SillyTavern.getContext();
    context.extensionSettings[MODULE_NAME] ??= {};
    return context.extensionSettings[MODULE_NAME];
}

function normalizeTokenLimit(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return DEFAULT_TRANSLATION_TOKENS;
    return Math.min(MAX_TRANSLATION_TOKENS, Math.max(MIN_TRANSLATION_TOKENS, number));
}

function getTranslationTokenLimit() {
    const settings = getExtensionSettings();
    const normalized = normalizeTokenLimit(settings[TOKEN_SETTING_KEY]);
    if (settings[TOKEN_SETTING_KEY] !== normalized) settings[TOKEN_SETTING_KEY] = normalized;
    return normalized;
}

function saveTokenLimit(value) {
    const settings = getExtensionSettings();
    settings[TOKEN_SETTING_KEY] = normalizeTokenLimit(value);
    SillyTavern.getContext().saveSettingsDebounced?.();
    return settings[TOKEN_SETTING_KEY];
}

function ensureTokenLimitUi() {
    const stack = document.querySelector('#itr_settings_overlay #itr_panel_body .itr-form-stack');
    if (!stack) return;

    let field = document.querySelector('#itr_max_translation_tokens_field');
    if (!field) {
        field = document.createElement('label');
        field.id = 'itr_max_translation_tokens_field';
        field.className = 'itr-field';
        field.innerHTML = `
            <span>번역 최대 출력 토큰</span>
            <input id="itr_max_translation_tokens" class="text_pole" type="number"
                min="${MIN_TRANSLATION_TOKENS}" max="${MAX_TRANSLATION_TOKENS}" step="256" inputmode="numeric">
            <small>번역 1회에 허용할 최대 출력량입니다. Thinking 설정은 Connection Profile 값을 그대로 사용합니다.</small>`;

        const usage = stack.querySelector('#itr_token_usage_wrap');
        stack.insertBefore(field, usage || null);

        const input = field.querySelector('#itr_max_translation_tokens');
        const commit = () => {
            input.value = String(saveTokenLimit(input.value));
        };
        input.addEventListener('change', commit);
        input.addEventListener('blur', commit);
    }

    const input = field.querySelector('#itr_max_translation_tokens');
    if (input && document.activeElement !== input) {
        input.value = String(getTranslationTokenLimit());
    }
}

if (!ConnectionManagerRequestService.__inputTranslatorMaxTokenSetting) {
    const baseSendRequest = ConnectionManagerRequestService.sendRequest.bind(ConnectionManagerRequestService);

    ConnectionManagerRequestService.sendRequest = function(profileId, prompt, maxTokens, custom, overridePayload) {
        const isTranslation = typeof prompt === 'string' && prompt.includes(TRANSLATION_MARKER);
        const effectiveMaxTokens = isTranslation ? getTranslationTokenLimit() : maxTokens;
        return baseSendRequest(profileId, prompt, effectiveMaxTokens, custom, overridePayload);
    };

    ConnectionManagerRequestService.__inputTranslatorMaxTokenSetting = true;
}

function scheduleTokenUi(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#itr_wand_settings, #itr_settings_overlay, #itr_translate_button')) return;
    setTimeout(ensureTokenLimitUi, 0);
}

document.addEventListener('click', scheduleTokenUi, true);
getTranslationTokenLimit();
ensureTokenLimitUi();
