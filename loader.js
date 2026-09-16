import { ConnectionManagerRequestService } from '../../shared.js';

const originalSendRequest = ConnectionManagerRequestService.sendRequest.bind(ConnectionManagerRequestService);
const translationMarker = 'You are a skilled Korean-to-English literary translator.';
const compileMarker = 'Convert the notes below into concise English translation-reference settings.';
const compilePayloadMarker = 'Return only the finished Markdown settings. No commentary or code fences.\n\n';
const alreadyEnhanced = 'Render Korean idioms, proverbs, culturally specific expressions';
const oldCapsRule = '- Use ALL CAPS only for genuine shouting or screaming.';
const enhancedBlock = `- Render Korean idioms, proverbs, culturally specific expressions, speech habits, implications, and emotional nuance as the closest natural equivalent in the target setting rather than translating them literally.
- Match the same social and emotional effect using language natural to the country, region, era, age, class, profession, and relationship established by SETTINGS and the provided context. Use context-appropriate idiom, slang, profanity, forms of address, titles, terminology, and phrasing while avoiding anachronistic or culturally mismatched wording.
- If no direct equivalent exists, recreate the intended nuance naturally without inventing new facts or changing the underlying meaning.
- Use ALL CAPS for genuine shouting or intense anger, including when repeated exclamation marks in SOURCE clearly signal that intensity.`;

const EXTENSION_NAME_KO = '알잘딱깔센';
const KOREAN_RE = /[\u3131-\u318E\uAC00-\uD7A3]/;
const SOURCE_OPEN = '<SOURCE>';
const SOURCE_CLOSE = '</SOURCE>';
const CHUNK_TRIGGER_CHARS = 2200;
const CHUNK_TARGET_CHARS = 1400;
const MAX_PARALLEL_CHUNKS = 2;

let capturedOriginal = '';

function compactStoredSettings() {
    const context = SillyTavern.getContext();
    const settings = context.extensionSettings?.inputTranslator;
    if (!settings || !Array.isArray(settings.presets)) return false;

    let changed = false;
    const allowedKeys = ['character', 'dialogue', 'expression', 'narration', 'additional'];

    for (const preset of settings.presets) {
        if ('createdAt' in preset) {
            delete preset.createdAt;
            changed = true;
        }
        if ('updatedAt' in preset) {
            delete preset.updatedAt;
            changed = true;
        }

        const sourceKo = preset.sourceKo && typeof preset.sourceKo === 'object' ? preset.sourceKo : {};
        const compactKo = {};
        for (const key of allowedKeys) {
            const value = String(sourceKo[key] ?? '').trim();
            if (value) compactKo[key] = value;
        }
        if (JSON.stringify(sourceKo) !== JSON.stringify(compactKo)) {
            preset.sourceKo = compactKo;
            changed = true;
        }

        const compiled = String(preset.compiledEn ?? '').trim();
        if (preset.compiledEn !== compiled) {
            preset.compiledEn = compiled;
            changed = true;
        }
    }

    return changed;
}

function saveCompactedSettings() {
    const context = SillyTavern.getContext();
    if (compactStoredSettings()) context.saveSettingsDebounced?.();
}

function getCompileInput(prompt) {
    if (typeof prompt !== 'string' || !prompt.includes(compileMarker)) return '';
    const index = prompt.lastIndexOf(compilePayloadMarker);
    if (index < 0) return '';
    return prompt.slice(index + compilePayloadMarker.length).trim();
}

function getSourceFromPrompt(prompt) {
    if (typeof prompt !== 'string') return '';
    const start = prompt.lastIndexOf(SOURCE_OPEN);
    const end = prompt.lastIndexOf(SOURCE_CLOSE);
    if (start < 0 || end <= start) return '';
    return prompt.slice(start + SOURCE_OPEN.length, end).replace(/^\n|\n$/g, '');
}

function replaceSourceInPrompt(prompt, source) {
    const start = prompt.lastIndexOf(SOURCE_OPEN);
    const end = prompt.lastIndexOf(SOURCE_CLOSE);
    if (start < 0 || end <= start) return prompt;
    return `${prompt.slice(0, start + SOURCE_OPEN.length)}\n${source}\n${prompt.slice(end)}`;
}

function getFastMaxTokens(source) {
    const estimated = Math.ceil(String(source ?? '').length * 1.35) + 192;
    return Math.max(384, Math.min(1536, estimated));
}

function findSplitPoint(text, limit) {
    if (text.length <= limit) return { index: text.length, separator: '' };

    const floor = Math.floor(limit * 0.55);
    const window = text.slice(floor, limit + 1);

    const candidates = [
        /\n{2,}/g,
        /\n/g,
        /[.!?。！？](?:["'”’)]*)\s+/g,
        /\s+/g,
    ];

    for (const regex of candidates) {
        let match;
        let last = null;
        while ((match = regex.exec(window)) !== null) last = match;
        if (last) {
            const absolute = floor + last.index;
            return {
                index: absolute,
                separator: last[0],
            };
        }
    }

    return { index: limit, separator: '' };
}

function splitSource(source, limit = CHUNK_TARGET_CHARS) {
    const chunks = [];
    let remaining = String(source ?? '');

    while (remaining.length > limit) {
        const { index, separator } = findSplitPoint(remaining, limit);
        const text = remaining.slice(0, index);
        if (!text) break;
        chunks.push({ text, separator });
        remaining = remaining.slice(index + separator.length);
    }

    if (remaining || !chunks.length) chunks.push({ text: remaining, separator: '' });
    return chunks;
}

async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;

    async function run() {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
}

function withFastReasoning(overridePayload) {
    const override = { ...(overridePayload ?? {}) };
    if (override.include_reasoning === false) override.reasoning_effort = 'min';
    return override;
}

function extractContent(response) {
    const content = response?.content;
    if (typeof content !== 'string') throw new Error('번역 결과를 읽을 수 없습니다.');
    return content;
}

async function fastTranslationRequest(profileId, prompt, maxTokens, custom, overridePayload) {
    const source = getSourceFromPrompt(prompt);
    const fastOverride = withFastReasoning(overridePayload);

    if (!source || source.length <= CHUNK_TRIGGER_CHARS) {
        return originalSendRequest(
            profileId,
            prompt,
            Math.min(maxTokens, getFastMaxTokens(source)),
            custom,
            fastOverride,
        );
    }

    const chunks = splitSource(source);
    const responses = await mapWithConcurrency(chunks, MAX_PARALLEL_CHUNKS, async chunk => {
        const chunkPrompt = replaceSourceInPrompt(prompt, chunk.text);
        return originalSendRequest(
            profileId,
            chunkPrompt,
            Math.min(maxTokens, getFastMaxTokens(chunk.text)),
            custom,
            fastOverride,
        );
    });

    const content = responses
        .map((response, index) => `${extractContent(response).trim()}${chunks[index].separator}`)
        .join('')
        .trim();

    return { ...(responses[0] ?? {}), content };
}

function syncMobileViewport() {
    const viewport = window.visualViewport;
    const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
    const offsetTop = Math.round(viewport?.offsetTop || 0);
    document.documentElement.style.setProperty('--itr-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--itr-viewport-top', `${offsetTop}px`);
}

function injectMobileUiFix() {
    if (document.querySelector('#itr_mobile_visibility_fix')) return;
    const style = document.createElement('style');
    style.id = 'itr_mobile_visibility_fix';
    style.textContent = `
@media (max-width: 600px) {
    .itr-overlay {
        top: var(--itr-viewport-top, 0px) !important;
        bottom: auto !important;
        height: var(--itr-viewport-height, 100dvh) !important;
        min-height: 0 !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        padding: max(12px, env(safe-area-inset-top)) 10px max(12px, env(safe-area-inset-bottom)) !important;
    }

    .itr-panel {
        width: 100% !important;
        max-width: 560px !important;
        max-height: calc(var(--itr-viewport-height, 100dvh) - 28px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) !important;
        margin: 0 !important;
        border: 1px solid var(--SmartThemeBorderColor) !important;
        border-radius: 14px !important;
    }

    .itr-header,
    .itr-tabs {
        flex: 0 0 auto !important;
    }

    .itr-panel-body {
        min-height: 0 !important;
        overflow-y: auto !important;
        overscroll-behavior: contain !important;
        -webkit-overflow-scrolling: touch !important;
    }
}`;
    document.head.appendChild(style);
}

function normalizeVisibleLabels() {
    const menuLabel = document.querySelector('#itr_wand_settings span');
    if (menuLabel && menuLabel.textContent !== EXTENSION_NAME_KO) menuLabel.textContent = EXTENSION_NAME_KO;

    const title = document.querySelector('#itr_settings_overlay .itr-title');
    if (title && title.textContent !== EXTENSION_NAME_KO) title.textContent = EXTENSION_NAME_KO;

    const panel = document.querySelector('#itr_settings_overlay .itr-panel');
    if (panel) panel.setAttribute('aria-label', EXTENSION_NAME_KO);
}

function prepareSettingsOpen(event) {
    const target = event.target instanceof Element ? event.target.closest('#itr_wand_settings') : null;
    if (!target) return;

    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    syncMobileViewport();
    setTimeout(syncMobileViewport, 60);
    setTimeout(syncMobileViewport, 180);
}

function setComposerValue(value) {
    const input = document.querySelector('#send_textarea');
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus({ preventScroll: true });
}

function restoreCapturedOriginal(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const restoreButton = target.closest('#itr_action_popover button');
    if (restoreButton?.textContent?.includes('되돌리기') && capturedOriginal) {
        event.preventDefault();
        event.stopImmediatePropagation();
        document.querySelector('#itr_action_popover')?.remove();
        setComposerValue(capturedOriginal);

        const translateButton = document.querySelector('#itr_translate_button');
        if (translateButton) {
            translateButton.classList.remove('itr-busy', 'itr-complete');
            translateButton.textContent = '🌐';
            translateButton.title = '입력 번역';
        }
        capturedOriginal = '';
        return;
    }

    const translateButton = target.closest('#itr_translate_button');
    if (!translateButton || translateButton.classList.contains('itr-busy') || translateButton.classList.contains('itr-complete')) return;

    const input = document.querySelector('#send_textarea');
    const value = String(input?.value ?? '');
    if (value.trim()) capturedOriginal = value;
}

document.addEventListener('pointerdown', prepareSettingsOpen, true);
document.addEventListener('click', restoreCapturedOriginal, true);
window.visualViewport?.addEventListener('resize', syncMobileViewport);
window.visualViewport?.addEventListener('scroll', syncMobileViewport);
window.addEventListener('orientationchange', () => {
    setTimeout(syncMobileViewport, 80);
    setTimeout(syncMobileViewport, 220);
});
window.addEventListener('resize', syncMobileViewport);

const uiObserver = new MutationObserver(() => normalizeVisibleLabels());
uiObserver.observe(document.documentElement, { childList: true, subtree: true });

if (!ConnectionManagerRequestService.__inputTranslatorNuancePatch) {
    ConnectionManagerRequestService.sendRequest = async function(profileId, prompt, maxTokens, custom, overridePayload) {
        let patchedPrompt = prompt;
        const isTranslation = typeof patchedPrompt === 'string' && patchedPrompt.includes(translationMarker);
        const isCompile = typeof patchedPrompt === 'string' && patchedPrompt.includes(compileMarker);
        const isTranslatorRequest = isTranslation || isCompile;

        if (isCompile) {
            const compileInput = getCompileInput(patchedPrompt);
            if (compileInput && !KOREAN_RE.test(compileInput)) {
                setTimeout(saveCompactedSettings, 0);
                return { content: compileInput };
            }
        }

        if (isTranslation) {
            if (!patchedPrompt.includes(alreadyEnhanced)) {
                patchedPrompt = patchedPrompt.includes(oldCapsRule)
                    ? patchedPrompt.replace(oldCapsRule, enhancedBlock)
                    : patchedPrompt.replace(
                        '- Match the source\'s register and character voice naturally. Avoid stiff literal translation, Korean calques, awkward machine-like English, purple prose, excessive slang, and unnecessarily literary wording.',
                        match => `${match}\n${enhancedBlock}`,
                    );
            }

            patchedPrompt = patchedPrompt
                .replace(/\n*<SETTINGS>\s*<\/SETTINGS>\n*/g, '\n')
                .replace(/\n*<PREVIOUS_OUTPUT>\s*<\/PREVIOUS_OUTPUT>\n*/g, '\n')
                .replace(/\n{3,}/g, '\n\n');

            const result = await fastTranslationRequest(profileId, patchedPrompt, maxTokens, custom, overridePayload);
            setTimeout(saveCompactedSettings, 0);
            return result;
        }

        const result = await originalSendRequest(profileId, patchedPrompt, maxTokens, custom, overridePayload);
        if (isTranslatorRequest) setTimeout(saveCompactedSettings, 0);
        return result;
    };
    ConnectionManagerRequestService.__inputTranslatorNuancePatch = true;
}

injectMobileUiFix();
syncMobileViewport();
saveCompactedSettings();
await import('./index.js');
normalizeVisibleLabels();
