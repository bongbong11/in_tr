import { ConnectionManagerRequestService } from '../../shared.js';

const KOREAN_SOURCE_RE = /[\u3131-\u318E\uAC00-\uD7A3]/;
const KOREAN_ONLY_TOAST = '스탑! 저는 한글 원문만 번역해요.';
const TRANSLATION_MARKER = 'You are a skilled Korean-to-English literary translator.';
const COMPILE_MARKER = 'Convert the notes below into concise English translation-reference settings.';

function isIdleTranslateButton(target) {
    const button = target instanceof Element ? target.closest('#itr_translate_button') : null;
    if (!button) return null;
    if (button.classList.contains('itr-busy') || button.classList.contains('itr-complete')) return null;
    return button;
}

function stopNonKoreanTranslation(event) {
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const button = isIdleTranslateButton(event.target);
    if (!button) return;

    const source = String(document.querySelector('#send_textarea')?.value ?? '');
    if (!source.trim() || KOREAN_SOURCE_RE.test(source)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (typeof window.toastr?.warning === 'function') {
        window.toastr.warning(KOREAN_ONLY_TOAST, undefined, { preventDuplicates: true });
    } else {
        console.info(`[알잘딱깔센] ${KOREAN_ONLY_TOAST}`);
    }
}

function getProfile(profileId) {
    try {
        return ConnectionManagerRequestService.getSupportedProfiles().find(profile => profile.id === profileId) ?? null;
    } catch {
        return null;
    }
}

function getApiSource(profile) {
    if (!profile) return '';
    const map = SillyTavern.getContext().CONNECT_API_MAP?.[profile.api];
    return String(map?.source ?? '').toLowerCase();
}

function isNativeGeminiProfile(profile) {
    const source = getApiSource(profile);
    return source === 'makersuite' || source === 'vertexai' || source === 'google';
}

function isTranslatorPrompt(prompt) {
    return typeof prompt === 'string' && (prompt.includes(TRANSLATION_MARKER) || prompt.includes(COMPILE_MARKER));
}

function normalizeContextOption() {
    const select = document.querySelector('#itr_context_turns');
    const offOption = select?.querySelector('option[value="0"]');
    if (offOption && offOption.textContent !== '참고 안 함') {
        offOption.textContent = '참고 안 함';
    }
}

// Translation requests do not need visible chain-of-thought. Suppress it for every provider.
// Native Gemini also gets the minimum supported thinking level. Custom/OpenAI-compatible
// endpoints do not receive reasoning_effort because many reject unsupported values.
if (!ConnectionManagerRequestService.__inputTranslatorThinkingGuard) {
    const baseSendRequest = ConnectionManagerRequestService.sendRequest.bind(ConnectionManagerRequestService);

    ConnectionManagerRequestService.sendRequest = async function(profileId, prompt, maxTokens, custom, overridePayload) {
        if (!isTranslatorPrompt(prompt)) {
            return baseSendRequest(profileId, prompt, maxTokens, custom, overridePayload);
        }

        const profile = getProfile(profileId);
        const override = { ...(overridePayload ?? {}), include_reasoning: false };

        if (isNativeGeminiProfile(profile)) {
            override.reasoning_effort = 'min';
        } else {
            delete override.reasoning_effort;
        }

        return baseSendRequest(profileId, prompt, maxTokens, custom, override);
    };

    ConnectionManagerRequestService.__inputTranslatorThinkingGuard = true;
}

document.addEventListener('click', stopNonKoreanTranslation, true);
document.addEventListener('keydown', stopNonKoreanTranslation, true);

const contextOptionObserver = new MutationObserver(normalizeContextOption);
contextOptionObserver.observe(document.documentElement, { childList: true, subtree: true });

await import('./loader.js');
normalizeContextOption();
