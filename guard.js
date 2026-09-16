const KOREAN_SOURCE_RE = /[\u3131-\u318E\uAC00-\uD7A3]/;
const KOREAN_ONLY_TOAST = '스탑! 저는 한글 원문만 번역해요.';

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

document.addEventListener('click', stopNonKoreanTranslation, true);
document.addEventListener('keydown', stopNonKoreanTranslation, true);

await import('./loader.js');
