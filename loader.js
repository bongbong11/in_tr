import { ConnectionManagerRequestService } from '../../shared.js';

const originalSendRequest = ConnectionManagerRequestService.sendRequest.bind(ConnectionManagerRequestService);
const translationMarker = 'You are a skilled Korean-to-English literary translator.';
const compileMarker = 'Convert the notes below into concise English translation-reference settings.';
const alreadyEnhanced = 'Render Korean idioms, proverbs, culturally specific expressions';
const oldCapsRule = '- Use ALL CAPS only for genuine shouting or screaming.';
const enhancedBlock = `- Render Korean idioms, proverbs, culturally specific expressions, speech habits, implications, and emotional nuance as the closest natural equivalent in the target setting rather than translating them literally.
- Match the same social and emotional effect using language natural to the country, region, era, age, class, profession, and relationship established by SETTINGS and the provided context. Use context-appropriate idiom, slang, profanity, forms of address, titles, terminology, and phrasing while avoiding anachronistic or culturally mismatched wording.
- If no direct equivalent exists, recreate the intended nuance naturally without inventing new facts or changing the underlying meaning.
- Use ALL CAPS for genuine shouting or intense anger, including when repeated exclamation marks in SOURCE clearly signal that intensity.`;

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

function syncMobileViewport() {
    const viewport = window.visualViewport;
    const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
    const offsetTop = Math.round(viewport?.offsetTop || 0);
    document.documentElement.style.setProperty('--itr-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--itr-viewport-top', `${offsetTop}px`);
}

function normalizeVisibleLabels() {
    const menuLabel = document.querySelector('#itr_wand_settings span');
    if (menuLabel && menuLabel.textContent !== '번역 설정 관리') menuLabel.textContent = '번역 설정 관리';

    const title = document.querySelector('#itr_settings_overlay .itr-title');
    if (title && title.textContent !== '번역 설정 관리') title.textContent = '번역 설정 관리';

    const panel = document.querySelector('#itr_settings_overlay .itr-panel');
    if (panel) panel.setAttribute('aria-label', '번역 설정 관리');
}

function prepareSettingsOpen(event) {
    const target = event.target instanceof Element ? event.target.closest('#itr_wand_settings') : null;
    if (!target) return;

    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    syncMobileViewport();
}

document.addEventListener('pointerdown', prepareSettingsOpen, true);
window.visualViewport?.addEventListener('resize', syncMobileViewport);
window.visualViewport?.addEventListener('scroll', syncMobileViewport);
window.addEventListener('orientationchange', () => setTimeout(syncMobileViewport, 80));
window.addEventListener('resize', syncMobileViewport);

const uiObserver = new MutationObserver(() => normalizeVisibleLabels());
uiObserver.observe(document.documentElement, { childList: true, subtree: true });

if (!ConnectionManagerRequestService.__inputTranslatorNuancePatch) {
    ConnectionManagerRequestService.sendRequest = async function(profileId, prompt, maxTokens, custom, overridePayload) {
        let patchedPrompt = prompt;
        const isTranslation = typeof patchedPrompt === 'string' && patchedPrompt.includes(translationMarker);
        const isTranslatorRequest = isTranslation || (typeof patchedPrompt === 'string' && patchedPrompt.includes(compileMarker));

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
        }

        const result = await originalSendRequest(profileId, patchedPrompt, maxTokens, custom, overridePayload);
        if (isTranslatorRequest) setTimeout(saveCompactedSettings, 0);
        return result;
    };
    ConnectionManagerRequestService.__inputTranslatorNuancePatch = true;
}

syncMobileViewport();
saveCompactedSettings();
await import('./index.js');
normalizeVisibleLabels();
