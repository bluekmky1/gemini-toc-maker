const messages = {
    ko: {
        settingsTitle: "설정",
        apiKeyLabel: "Gemini API Key",
        apiKeyPlaceholder: "API 키를 입력하세요",
        saveBtn: "설정 저장",
        footerText: "Google Gemini API Key를 입력하여 요약 기능을 활성화하세요.",
        saveSuccess: "설정이 저장되었습니다!"
    },
    en: {
        settingsTitle: "Settings",
        apiKeyLabel: "Gemini API Key",
        apiKeyPlaceholder: "Paste your API key here",
        saveBtn: "Save Settings",
        footerText: "Enter your Google Gemini API Key to enable summarization.",
        saveSuccess: "Settings saved!"
    }
};

function getMsg(key) {
    const lang = navigator.language.split('-')[0];
    const dict = messages[lang] || messages['en'];
    return dict[key] || messages['en'][key];
}

document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const saveBtn = document.getElementById('saveBtn');

    // Apply i18n text
    document.querySelector('h3').textContent = getMsg('settingsTitle');
    document.querySelector('label[for="apiKey"]').textContent = getMsg('apiKeyLabel');
    apiKeyInput.placeholder = getMsg('apiKeyPlaceholder');
    saveBtn.textContent = getMsg('saveBtn');
    document.querySelector('.footer').textContent = getMsg('footerText');

    // Load existing settings
    chrome.storage.local.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }
    });

    saveBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
            alert(getMsg('saveSuccess'));
        });
    });
});
