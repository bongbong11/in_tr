import { ConnectionManagerRequestService } from '../../shared.js';
import { oai_settings } from '../../../openai.js';
import { substituteParams } from '../../../../script.js';

const KOREAN_SOURCE_RE = /[\u3131-\u318E\uAC00-\uD7A3]/;
const KOREAN_ONLY_TOAST = '스탑! 저는 한글 원문만 번역해요.';
const TRANSLATION_MARKER = 'You are a skilled Korean-to-English literary translator.';
const COMPILE_MARKER = 'Convert the notes below into concise English translation-reference settings.';
const MAX_USAGE_RECORDS = 20;

const usageRecords = [];
const usageSessions = new WeakMap();

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

function getProfileSource(profile) {
    const apiMap = SillyTavern.getContext().CONNECT_API_MAP?.[profile?.api];
    return String(apiMap?.source ?? '').toLowerCase();
}

function buildTranslatorOverride(profile, overridePayload) {
    const override = { ...(overridePayload ?? {}) };

    // Never force thinking/reasoning from the extension. Let the selected
    // Connection Profile/provider decide. Also do not blank the profile's
    // own prompt post-processing setting.
    delete override.reasoning_effort;
    delete override.include_reasoning;
    delete override.custom_prompt_post_processing;

    // ConnectionManagerRequestService does not automatically forward the
    // Custom AI extra header/body fields that normal SillyTavern generation
    // sends. Preserve them here so custom OpenAI-compatible endpoints receive
    // the same auth/body customization as the user's normal Custom AI setup.
    if (getProfileSource(profile) === 'custom') {
        override.custom_include_headers = substituteParams(oai_settings.custom_include_headers ?? '');
        override.custom_include_body = substituteParams(oai_settings.custom_include_body ?? '');
        override.custom_exclude_body = substituteParams(oai_settings.custom_exclude_body ?? '');
    }

    return override;
}

function isTranslatorPrompt(prompt) {
    return typeof prompt === 'string' && (prompt.includes(TRANSLATION_MARKER) || prompt.includes(COMPILE_MARKER));
}

function isTranslationPrompt(prompt) {
    return typeof prompt === 'string' && prompt.includes(TRANSLATION_MARKER);
}

function normalizeContextOption() {
    const select = document.querySelector('#itr_context_turns');
    const offOption = select?.querySelector('option[value="0"]');
    if (offOption && offOption.textContent !== '0개 선택 · 참고 안 함') {
        offOption.textContent = '0개 선택 · 참고 안 함';
    }
    ensureUsageTrackerUi();
}

async function countTokens(text) {
    const value = String(text ?? '');
    if (!value) return 0;

    try {
        const counter = SillyTavern.getContext()?.getTokenCountAsync;
        if (typeof counter === 'function') {
            const count = await counter(value, 0);
            if (Number.isFinite(Number(count))) return Number(count);
        }
    } catch (error) {
        console.debug('[알잘딱깔센] Token counter fallback:', error);
    }

    return Math.max(1, Math.ceil(value.length / 4));
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function getUsageSession(signal, profile) {
    if (!signal || (typeof signal !== 'object' && typeof signal !== 'function')) {
        return {
            input: 0,
            output: 0,
            requests: 0,
            active: 0,
            pendingCounts: 0,
            finalized: false,
            failed: false,
            profile: profile?.name || '',
            model: profile?.model || '',
            startedAt: Date.now(),
        };
    }

    let session = usageSessions.get(signal);
    if (!session) {
        session = {
            input: 0,
            output: 0,
            requests: 0,
            active: 0,
            pendingCounts: 0,
            finalized: false,
            failed: false,
            profile: profile?.name || '',
            model: profile?.model || '',
            startedAt: Date.now(),
        };
        usageSessions.set(signal, session);
    }
    return session;
}

function finalizeUsageSession(session) {
    if (!session || session.finalized || session.active > 0 || session.pendingCounts > 0) return;
    session.finalized = true;

    if (session.failed && session.output <= 0) return;

    const record = {
        input: Math.round(session.input),
        output: Math.round(session.output),
        requests: session.requests,
        profile: session.profile,
        model: session.model,
        time: Date.now(),
    };

    usageRecords.unshift(record);
    if (usageRecords.length > MAX_USAGE_RECORDS) usageRecords.length = MAX_USAGE_RECORDS;

    console.info(`[알잘딱깔센] 번역 토큰 ${formatNumber(record.input)} → ${formatNumber(record.output)}${record.requests > 1 ? ` (${record.requests} requests)` : ''}`);
    renderUsageTracker();
}

function scheduleUsageFinalize(session) {
    setTimeout(() => finalizeUsageSession(session), 0);
}

function addCountTask(session, kind, text) {
    session.pendingCounts += 1;
    countTokens(text)
        .then(count => {
            session[kind] += count;
        })
        .catch(error => console.debug('[알잘딱깔센] Token count failed:', error))
        .finally(() => {
            session.pendingCounts = Math.max(0, session.pendingCounts - 1);
            scheduleUsageFinalize(session);
        });
}

function injectUsageStyles() {
    if (document.querySelector('#itr_usage_tracker_style')) return;
    const style = document.createElement('style');
    style.id = 'itr_usage_tracker_style';
    style.textContent = `
#itr_token_usage_wrap { margin-top: 4px; }
#itr_token_usage_button { width: 100%; justify-content: center; }
#itr_token_usage_panel {
    margin-top: 8px;
    padding: 10px;
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 10px;
    background: color-mix(in srgb, var(--SmartThemeBlurTintColor) 82%, transparent);
}
.itr-usage-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.itr-usage-head strong { font-size: 0.95em; }
#itr_token_usage_clear { min-width: auto; padding: 4px 8px; font-size: 0.8em; }
.itr-usage-latest {
    padding: 10px;
    margin-bottom: 8px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--SmartThemeBodyColor) 7%, transparent);
}
.itr-usage-latest-value { font-size: 1.18em; font-weight: 700; letter-spacing: 0.01em; }
.itr-usage-list { display: flex; flex-direction: column; gap: 5px; max-height: 190px; overflow-y: auto; }
.itr-usage-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 6px 2px; border-top: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor) 55%, transparent); }
.itr-usage-meta { min-width: 0; font-size: 0.78em; opacity: 0.72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.itr-usage-value { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 0.9em; }
.itr-usage-note { display: block; margin-top: 8px; opacity: 0.65; line-height: 1.35; }
`;
    document.head.appendChild(style);
}

function ensureUsageTrackerUi() {
    injectUsageStyles();
    const stack = document.querySelector('#itr_settings_overlay #itr_panel_body .itr-form-stack');
    if (!stack || document.querySelector('#itr_token_usage_wrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'itr_token_usage_wrap';
    wrap.innerHTML = `
        <button type="button" id="itr_token_usage_button" class="menu_button">📊 토큰 사용량</button>
        <div id="itr_token_usage_panel" hidden>
            <div class="itr-usage-head">
                <strong>번역 토큰 추적</strong>
                <button type="button" id="itr_token_usage_clear" class="menu_button">기록 지우기</button>
            </div>
            <div id="itr_token_usage_content"></div>
            <small class="itr-usage-note">실제 번역 요청에 전달된 전체 프롬프트와 반환된 번역문을 SillyTavern 토크나이저로 계산합니다. 모델 제공사의 과금 집계와는 소폭 다를 수 있습니다.</small>
        </div>`;
    stack.appendChild(wrap);

    const button = wrap.querySelector('#itr_token_usage_button');
    const panel = wrap.querySelector('#itr_token_usage_panel');
    button.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        renderUsageTracker();
    });
    wrap.querySelector('#itr_token_usage_clear').addEventListener('click', () => {
        usageRecords.length = 0;
        renderUsageTracker();
    });

    renderUsageTracker();
}

function renderUsageTracker() {
    const button = document.querySelector('#itr_token_usage_button');
    const content = document.querySelector('#itr_token_usage_content');
    const latest = usageRecords[0];

    if (button) {
        button.textContent = latest
            ? `📊 토큰 사용량 · ${formatNumber(latest.input)} → ${formatNumber(latest.output)}`
            : '📊 토큰 사용량';
    }

    if (!content) return;
    if (!usageRecords.length) {
        content.innerHTML = '<div class="itr-empty-state">아직 번역 기록이 없습니다.</div>';
        return;
    }

    const latestLabel = `${formatNumber(latest.input)} → ${formatNumber(latest.output)}`;
    const rows = usageRecords.map(record => {
        const time = new Date(record.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const name = record.model || record.profile || '번역 모델';
        const safeName = escapeHtml(name);
        const requestNote = record.requests > 1 ? ` · ${record.requests}회 분할` : '';
        return `
            <div class="itr-usage-row">
                <div class="itr-usage-meta" title="${safeName}">${escapeHtml(time)} · ${safeName}${requestNote}</div>
                <div class="itr-usage-value">${formatNumber(record.input)} → ${formatNumber(record.output)}</div>
            </div>`;
    }).join('');

    content.innerHTML = `
        <div class="itr-usage-latest">
            <div class="itr-usage-meta">최근 번역 · 입력 → 출력</div>
            <div class="itr-usage-latest-value">${latestLabel}</div>
        </div>
        <div class="itr-usage-list">${rows}</div>`;
}

// Keep provider/model/auth and thinking behavior from the selected Connection Profile.
// Only the roleplay generation preset/instruct injection remains disabled by index.js.
if (!ConnectionManagerRequestService.__inputTranslatorThinkingGuard) {
    const baseSendRequest = ConnectionManagerRequestService.sendRequest.bind(ConnectionManagerRequestService);

    ConnectionManagerRequestService.sendRequest = async function(profileId, prompt, maxTokens, custom, overridePayload) {
        if (!isTranslatorPrompt(prompt)) {
            return baseSendRequest(profileId, prompt, maxTokens, custom, overridePayload);
        }

        const profile = getProfile(profileId);
        const override = buildTranslatorOverride(profile, overridePayload);

        if (!isTranslationPrompt(prompt)) {
            return baseSendRequest(profileId, prompt, maxTokens, custom, override);
        }

        const session = getUsageSession(custom?.signal, profile);
        session.active += 1;
        session.requests += 1;
        addCountTask(session, 'input', prompt);

        try {
            const response = await baseSendRequest(profileId, prompt, maxTokens, custom, override);
            addCountTask(session, 'output', response?.content ?? '');
            return response;
        } catch (error) {
            session.failed = true;
            throw error;
        } finally {
            session.active = Math.max(0, session.active - 1);
            scheduleUsageFinalize(session);
        }
    };

    ConnectionManagerRequestService.__inputTranslatorThinkingGuard = true;
}

document.addEventListener('click', stopNonKoreanTranslation, true);
document.addEventListener('keydown', stopNonKoreanTranslation, true);

const contextOptionObserver = new MutationObserver(normalizeContextOption);
contextOptionObserver.observe(document.documentElement, { childList: true, subtree: true });

await import('./loader.js');
normalizeContextOption();
