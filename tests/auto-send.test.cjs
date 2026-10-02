const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup({ auto = true, text = '안녕하세요', show = true } = {}) {
    const listeners = {};
    class Element {
        constructor(id) {
            this.id = id;
            this.value = '';
            const classes = new Set();
            this.classList = {
                contains: key => classes.has(key),
                toggle: (key, enabled) => enabled ? classes.add(key) : classes.delete(key),
            };
        }
        closest(selector) { return selector === `#${this.id}` ? this : null; }
        focus() {}
        dispatchEvent(event) {
            Object.defineProperty(event, 'target', { value: this });
            for (const callback of listeners[event.type] ?? []) callback(event);
            return true;
        }
    }
    const input = new Element('send_textarea');
    input.value = text;
    const button = new Element('itr_translate_button');
    const send = new Element('send_but');
    const settings = { autoTranslateOnSend: auto, showTranslateButton: show, profileId: 'profile' };
    const chatListeners = {};
    const context = {
        chat: [], extensionSettings: { inputTranslator: settings },
        eventTypes: { CHAT_CHANGED: 'chat_changed' },
        eventSource: { on: (key, callback) => { chatListeners[key] = callback; } },
        saveSettingsDebounced() {},
    };
    const requests = [];
    const sends = [];
    let chatId = 'chat-1';
    let enterEnabled = true;
    let sendResult;
    const sandbox = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        SillyTavern: { getContext: () => context },
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => [{ id: 'profile' }],
            sendRequest: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
        },
        getCurrentChatId: () => chatId,
        shouldSendOnEnter: () => enterEnabled,
        is_send_press: false,
        sendTextareaMessage: async () => { sends.push(input.value); return sendResult; },
        Element, Event, AbortController, DOMException,
        setInterval() { return 1; }, clearInterval() {}, setTimeout() {},
        document: {
            readyState: 'loading',
            querySelector: selector => ({ '#send_textarea': input, '#itr_translate_button': button, '#send_but': send })[selector] ?? null,
            querySelectorAll: () => [],
            addEventListener: (type, callback) => (listeners[type] ??= []).push(callback),
        },
        window: { addEventListener() {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(source + '\nthis.api = { runtime, init, interceptSend, translateSource, onTranslateButtonClick, updateSendControls, getSettings };', sandbox);
    vm.runInContext('openSettings = () => {};', sandbox);
    sandbox.api.init();
    function event(type = 'click', extra = {}) {
        return {
            type, target: type === 'keydown' ? input : send,
            key: type === 'keydown' ? 'Enter' : undefined,
            prevented: false, stopped: false,
            preventDefault() { this.prevented = true; },
            stopImmediatePropagation() { this.stopped = true; },
            ...extra,
        };
    }
    function intercept(type, extra) {
        const e = event(type, extra);
        sandbox.api.interceptSend(e);
        return e;
    }
    return {
        ...sandbox.api, input, button, send, context, settings, requests, sends, intercept,
        setEnterEnabled: value => { enterEnabled = value; },
        setGenerating: value => { sandbox.is_send_press = value; },
        setSendResult: value => { sendResult = value; },
        changeChat: value => { chatId = value; chatListeners.chat_changed(); },
        reply: value => requests.at(-1).resolve({ content: value }),
        edit: value => { input.value = value; input.dispatchEvent(new Event('input')); },
    };
}

for (const type of ['click', 'keydown']) {
    test(`${type}: intercept first, then send only the translation`, async () => {
        const s = setup();
        const e = s.intercept(type);
        assert.ok(e.prevented && e.stopped);
        assert.deepEqual(s.sends, []);
        s.reply('Hello.');
        await flush();
        assert.deepEqual(s.sends, ['Hello.']);
        assert.equal(s.requests.length, 1);
        assert.equal(s.runtime.autoSendPending, false);
    });
}

test('repeated Enter and double clicks do not enqueue another request or send', async () => {
    const s = setup();
    s.intercept('keydown');
    assert.ok(s.intercept('keydown', { repeat: true }).prevented);
    assert.ok(s.intercept('click').prevented);
    s.reply('Hello.');
    await flush();
    assert.equal(s.requests.length, 1);
    assert.deepEqual(s.sends, ['Hello.']);
});

test('the send lock lasts for the asynchronous host send', async () => {
    const s = setup();
    let finish;
    s.setSendResult(new Promise(resolve => { finish = resolve; }));
    s.intercept('click');
    s.reply('Hello.');
    await flush();
    assert.equal(s.runtime.autoSendPending, true);
    assert.ok(s.intercept('click').prevented);
    finish();
    await flush();
    assert.equal(s.runtime.autoSendPending, false);
    assert.deepEqual(s.sends, ['Hello.']);
});

for (const response of ['', '  ', '안녕하세요', '/send dangerous']) {
    test(`invalid translation ${JSON.stringify(response)} never sends`, async () => {
        const s = setup();
        s.intercept('click');
        s.reply(response);
        await flush();
        assert.deepEqual(s.sends, []);
        assert.equal(s.input.value, '안녕하세요');
        assert.equal(s.runtime.currentAbortController, null);
    });
}

test('provider failure leaves the source and allows a deliberate retry', async () => {
    const s = setup();
    s.intercept('click');
    s.requests[0].reject(new Error('Network failure'));
    await flush();
    assert.deepEqual(s.sends, []);
    assert.equal(s.input.value, '안녕하세요');
    s.intercept('click');
    assert.equal(s.requests.length, 2);
    s.reply('Hello again.');
    await flush();
    assert.deepEqual(s.sends, ['Hello again.']);
});

test('globe cancels even if the provider ignores the abort signal', async () => {
    const s = setup({ show: false });
    s.updateSendControls();
    assert.ok(s.button.classList.contains('itr-hidden'));
    s.intercept('click');
    assert.ok(!s.button.classList.contains('itr-hidden'));
    await s.onTranslateButtonClick();
    assert.ok(s.requests[0].args[3].signal.aborted);
    s.reply('Hello.');
    await flush();
    assert.deepEqual(s.sends, []);
    assert.equal(s.input.value, '안녕하세요');
    assert.ok(s.button.classList.contains('itr-hidden'));
});

test('editing, including edit then undo, invalidates the pending result', async () => {
    const s = setup();
    s.intercept('click');
    s.edit('새 입력');
    s.edit('안녕하세요');
    s.reply('Hello.');
    await flush();
    assert.deepEqual(s.sends, []);
    assert.equal(s.input.value, '안녕하세요');
});

test('switching chats, even away and back, cancels pending translation', async () => {
    const s = setup();
    s.intercept('click');
    s.changeChat('chat-2');
    s.changeChat('chat-1');
    s.reply('Hello.');
    await flush();
    assert.deepEqual(s.sends, []);
    assert.equal(s.input.value, '안녕하세요');
});

test('turning auto send off while translating never sends', async () => {
    const s = setup();
    s.intercept('click');
    s.settings.autoTranslateOnSend = false;
    s.reply('Hello.');
    await flush();
    assert.deepEqual(s.sends, []);
    assert.equal(s.input.value, '안녕하세요');
});

test('Shift+Enter keeps line breaks and IME Enter never starts a send', () => {
    const s = setup();
    assert.equal(s.intercept('keydown', { shiftKey: true }).prevented, false);
    const ime = s.intercept('keydown', { isComposing: true });
    assert.equal(ime.prevented, false);
    assert.equal(ime.stopped, true);
    assert.equal(s.requests.length, 0);
    assert.equal(s.intercept('keydown', { keyCode: 229 }).stopped, true);
});

test('Ctrl+Enter with input also cannot leak the Korean source', async () => {
    const s = setup();
    assert.ok(s.intercept('keydown', { ctrlKey: true }).prevented);
    s.reply('Hello.');
    await flush();
    assert.deepEqual(s.sends, ['Hello.']);
});

test('disabled Enter sending, English, empty input and slash commands pass through', () => {
    const s = setup();
    s.setEnterEnabled(false);
    assert.equal(s.intercept('keydown').prevented, false);
    for (const text of ['Hello.', '', '/echo 한글']) {
        s.input.value = text;
        assert.equal(s.intercept('click').prevented, false);
    }
    assert.equal(s.requests.length, 0);
});

test('default settings keep manual mode and visible globe', () => {
    const s = setup();
    delete s.settings.autoTranslateOnSend;
    delete s.settings.showTranslateButton;
    const settings = s.getSettings();
    assert.equal(settings.autoTranslateOnSend, false);
    assert.equal(settings.showTranslateButton, true);
});

test('manual translation still updates input, never auto sends, and blocks send while busy', async () => {
    const s = setup({ auto: false });
    assert.equal(s.intercept('click').prevented, false);
    const pending = s.onTranslateButtonClick();
    assert.ok(s.intercept('click').prevented);
    s.reply('Hello.');
    await pending;
    assert.equal(s.input.value, 'Hello.');
    assert.deepEqual(s.sends, []);
    assert.equal(s.intercept('click').prevented, false);
});

test('missing profile and existing host generation cannot send source', async () => {
    const s = setup();
    s.settings.profileId = '';
    assert.ok(s.intercept('click').prevented);
    await flush();
    assert.deepEqual(s.sends, []);
    assert.equal(s.requests.length, 0);
    s.settings.profileId = 'profile';
    s.setGenerating(true);
    assert.ok(s.intercept('click').prevented);
    assert.equal(s.requests.length, 0);
});
