import { ConnectionManagerRequestService } from '../../shared.js';

const originalSendRequest = ConnectionManagerRequestService.sendRequest.bind(ConnectionManagerRequestService);
const marker = 'You are a skilled Korean-to-English literary translator.';
const alreadyEnhanced = 'Render Korean idioms, proverbs, culturally specific expressions';
const oldCapsRule = '- Use ALL CAPS only for genuine shouting or screaming.';
const enhancedBlock = `- Render Korean idioms, proverbs, culturally specific expressions, speech habits, implications, and emotional nuance as the closest natural equivalent in the target setting rather than translating them literally.
- Match the same social and emotional effect using language natural to the country, region, era, age, class, profession, and relationship established by SETTINGS and the provided context. Use context-appropriate idiom, slang, profanity, forms of address, titles, terminology, and phrasing while avoiding anachronistic or culturally mismatched wording.
- If no direct equivalent exists, recreate the intended nuance naturally without inventing new facts or changing the underlying meaning.
- Use ALL CAPS for genuine shouting or intense anger, including when repeated exclamation marks in SOURCE clearly signal that intensity.`;

if (!ConnectionManagerRequestService.__inputTranslatorNuancePatch) {
    ConnectionManagerRequestService.sendRequest = async function(profileId, prompt, maxTokens, custom, overridePayload) {
        let patchedPrompt = prompt;
        if (
            typeof patchedPrompt === 'string'
            && patchedPrompt.includes(marker)
            && !patchedPrompt.includes(alreadyEnhanced)
        ) {
            patchedPrompt = patchedPrompt.includes(oldCapsRule)
                ? patchedPrompt.replace(oldCapsRule, enhancedBlock)
                : patchedPrompt.replace(
                    '- Match the source\'s register and character voice naturally. Avoid stiff literal translation, Korean calques, awkward machine-like English, purple prose, excessive slang, and unnecessarily literary wording.',
                    match => `${match}\n${enhancedBlock}`,
                );
        }
        return originalSendRequest(profileId, patchedPrompt, maxTokens, custom, overridePayload);
    };
    ConnectionManagerRequestService.__inputTranslatorNuancePatch = true;
}

import('./index.js');
