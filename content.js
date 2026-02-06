// Gemini ToC Content Script
console.log('Gemini ToC Content Script initialized.');

let chatObserver = null;
let tocContainer = null;
let currentActiveTurnId = null; // Track current active item
const messageBlocks = new Map(); // Store summarized data: turnId -> { title, subtitles, status }
let isTocRequested = false; // Flag to track manual request state

// --- UI Logic ---

// i18n Dictionary
const messages = {
    ko: {
        title: "목차",
        summarizing: "요약중...",
        apiKeyWarning: "API Key 설정 필요",
        collapse: "모두 접기",
        refresh: "목차 새로고침",
        refresh: "Regenerate ToC",
        generateToC: "Generate ToC",
        donate: "Buy me a coffee"
    },
    ko: {
        title: "목차",
        summarizing: "요약중...",
        apiKeyWarning: "API Key 설정 필요",
        collapse: "모두 접기",
        refresh: "목차 새로고침",
        generateToC: "목차 생성",
        donate: "개발자에게 커피 한 잔 ☕️"
    }
};

function getMsg(key) {
    const lang = navigator.language.split('-')[0];
    const dict = messages[lang] || messages['en'];
    return dict[key] || messages['en'][key];
}

function createToCContainer() {
    if (document.getElementById('gemini-toc-container')) return;
    
    tocContainer = document.createElement('div');
    tocContainer.id = 'gemini-toc-container';
    tocContainer.innerHTML = `
        <h3>
            <span>${getMsg('title')}</span>
            <div class="toc-header-actions">
                <a id="toc-donate-btn" href="https://buymeacoffee.com/majaehoon" target="_blank" title="${getMsg('donate')}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
                        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
                        <line x1="6" y1="1" x2="6" y2="4"></line>
                        <line x1="10" y1="1" x2="10" y2="4"></line>
                        <line x1="14" y1="1" x2="14" y2="4"></line>
                    </svg>
                </a>
                <button id="toc-collapse-btn" title="${getMsg('collapse')}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2v6"></path>
                        <path d="M12 22v-6"></path>
                        <path d="m8 18 4-4 4 4"></path>
                        <path d="m8 6 4 4 4-4"></path>
                    </svg>
                </button>
                <button id="toc-refresh-btn" title="${getMsg('refresh')}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M23 4v6h-6"></path>
                        <path d="M1 20v-6h6"></path>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                </button>
            </div>
        </h3>
        <div id="toc-api-warning" class="toc-api-warning" style="display:none;">
            <span class="warning-icon">⚠️</span>
            <span class="warning-text">${getMsg('apiKeyWarning')}</span>
        </div>
        <div id="toc-list"></div>
    `;
    document.body.appendChild(tocContainer);

    // Refocus active item when expanded (hovered) with a delay to allow stable expansion
    let refocusTimeout = null;
    tocContainer.addEventListener('mouseenter', () => {
        clearTimeout(refocusTimeout);
        refocusTimeout = setTimeout(() => {
            if (currentActiveTurnId) {
                setActiveTocItem(currentActiveTurnId);
            }
        }, 260); // Sync with 0.25s transition
    });

    tocContainer.addEventListener('mouseleave', () => {
        clearTimeout(refocusTimeout);
    });
    
    document.getElementById('toc-refresh-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        refreshAllBlocks();
    });

    document.getElementById('toc-collapse-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        collapseAllItems();
    });

    // Check API Key and listen for changes
    checkApiKeyStatus();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.geminiApiKey) {
            checkApiKeyStatus();
        }
    });

    console.log('ToC Container created with Action buttons.');
}

function checkApiKeyStatus() {
    chrome.storage.local.get(['geminiApiKey'], (result) => {
        const warningEl = document.getElementById('toc-api-warning');
        if (!warningEl) return;
        
        if (!result.geminiApiKey) {
            warningEl.style.display = 'block';
        } else {
            warningEl.style.display = 'none';
        }
    });
}

function collapseAllItems() {
    document.querySelectorAll('.toc-item.expanded').forEach(item => {
        item.classList.remove('expanded');
    });
}

function refreshAllBlocks() {
    const btn = document.getElementById('toc-refresh-btn');
    if (btn) btn.classList.add('rotating');
    
    console.log('Refreshing all ToC items...');
    
    // Check API key again on refresh attempt
    checkApiKeyStatus();
    
    // Clear all existing data
    messageBlocks.clear();
    updateToCUI();
    
    // Re-process all blocks
    processNewMessages();
    
    setTimeout(() => {
        if (btn) btn.classList.remove('rotating');
    }, 1500);
}

function updateToCUI() {
    const list = document.getElementById('toc-list');
    if (!list) return;

    // If ToC hasn't been requested and there are no blocks, show the generate button
    if (!isTocRequested && messageBlocks.size === 0) {
        list.innerHTML = ''; // Clear for initial state
        const turns = document.querySelectorAll('.conversation-container, model-response');
        const hasContent = turns.length > 0;

        const initContainer = document.createElement('div');
        initContainer.className = 'toc-init-container';
        
        const generateBtn = document.createElement('button');
        generateBtn.className = 'toc-generate-btn';
        if (!hasContent) {
            generateBtn.disabled = true;
            generateBtn.title = '대화 내용이 없어 생성할 수 없습니다.';
        }
        
        generateBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.21 1.21 0 0 0 1.72 0L21.64 5.36a1.21 1.21 0 0 0 0-1.72Z"></path>
                <path d="m14 7 3 3"></path>
                <path d="M5 6v4"></path>
                <path d="M19 14v4"></path>
                <path d="M10 2v2"></path>
                <path d="M7 8H3"></path>
                <path d="M21 16h-4"></path>
                <path d="M11 3H9"></path>
            </svg>
            <span class="btn-text">${getMsg('generateToC')}</span>
        `;
        
        if (hasContent) {
            generateBtn.onclick = () => {
                isTocRequested = true;
                processNewMessages();
            };
        }
        
        initContainer.appendChild(generateBtn);
        list.appendChild(initContainer);
        return;
    }

    // Get current items in DOM to avoid rebuilding everything if possible
    const existingItems = new Map();
    list.querySelectorAll('.toc-item').forEach(item => {
        existingItems.set(item.getAttribute('data-turn-id'), item);
    });

    // Get DOM order of conversation blocks
    const domBlocks = document.querySelectorAll('.conversation-container, model-response');
    const domOrder = new Set();
    const fragment = document.createDocumentFragment();
    
    domBlocks.forEach((block, idx) => {
        const turnId = block.id || `generated-id-${idx}`;
        const data = messageBlocks.get(turnId);
        if (!data) return;

        domOrder.add(turnId);
        
        let item = existingItems.get(turnId);
        const needsRebuild = !item || 
                           item.querySelector('.toc-text').innerText !== (data.title || getMsg('summarizing')) ||
                           item.classList.contains('error') !== (data.status === 'error');

        if (needsRebuild) {
            const newItem = createTocItem(turnId, data);
            fragment.appendChild(newItem);
        } else {
            fragment.appendChild(item);
        }
    });

    // Clear and append at once
    list.innerHTML = '';
    list.appendChild(fragment);
}

function createTocItem(turnId, data) {
    const item = document.createElement('div');
    item.className = 'toc-item';
    item.setAttribute('data-turn-id', turnId);
    
    const itemHeader = document.createElement('div');
    itemHeader.className = 'toc-item-header';
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'toc-text';
    titleSpan.innerText = data.title || getMsg('summarizing');
    itemHeader.appendChild(titleSpan);
    
    if (data.status === 'error') {
        item.classList.add('error');
        const retryBtn = document.createElement('button');
        retryBtn.className = 'toc-item-retry-btn';
        retryBtn.title = '다시 시도';
        retryBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 4v6h-6"></path>
                <path d="M1 20v-6h6"></path>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
        `;
        retryBtn.onclick = (e) => {
            e.stopPropagation();
            retryBtn.classList.add('rotating');
            messageBlocks.set(turnId, { title: null, subtitles: [], status: 'loading' });
            updateToCUI();
            
            const blocks = document.querySelectorAll('.conversation-container, model-response');
            blocks.forEach((block, bIdx) => {
                const bTurnId = block.id || `generated-id-${bIdx}`;
                if (bTurnId === turnId) {
                    const response = block.tagName === 'MODEL-RESPONSE' ? block : block.querySelector('model-response');
                    if (response) {
                        const textElement = response.querySelector('.markdown-main-panel, .markdown, .message-content');
                        if (textElement) {
                            const content = textElement.innerText.trim();
                            if (content && content.length >= 10) {
                                requestSummary(turnId, content);
                            }
                        }
                    }
                }
            });
        };
        itemHeader.appendChild(retryBtn);
    }
    
    if (data.subtitles && data.subtitles.length > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'toc-chevron';
        arrow.innerHTML = '‹';
        arrow.onclick = (e) => {
            e.stopPropagation();
            item.classList.toggle('expanded');
        };
        itemHeader.appendChild(arrow);
    }
    
    item.appendChild(itemHeader);
    item.onclick = () => scrollToMessage(turnId);
    
    if (data.subtitles && data.subtitles.length > 0) {
        const subList = document.createElement('div');
        subList.className = 'toc-sub-list';
        data.subtitles.forEach(sub => {
            const subItem = document.createElement('div');
            subItem.className = 'toc-sub-item';
            const subSpan = document.createElement('span');
            subSpan.className = 'toc-text';
            subSpan.innerText = sub;
            subItem.appendChild(subSpan);
            subList.appendChild(subItem);
        });
        item.appendChild(subList);
    }
    
    return item;
}

function scrollToMessage(turnId) {
    const target = document.getElementById(turnId);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        console.warn(`Target turnId ${turnId} not found in DOM. Need to scroll up to load.`);
        // Placeholder for smart scroll logic
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// --- Extraction Logic ---

function processNewMessages() {
    if (!isTocRequested) {
        updateToCUI();
        return;
    }
    // Gemini turns are usually in .conversation-container or inside chat-turn
    const turns = document.querySelectorAll('.conversation-container');
    if (turns.length === 0) {
        // Fallback for different versions or structures
        const modelResponses = document.querySelectorAll('model-response');
        modelResponses.forEach((res, idx) => {
            const turnId = `generated-id-${idx}`;
            processBlock(turnId, res);
        });
        return;
    }

    turns.forEach(turn => {
        const turnId = turn.id;
        if (!turnId) return;
        
        const response = turn.querySelector('model-response');
        if (!response) return;

        processBlock(turnId, response);
    });
    
    // Observe any new turns for active scroll highlighting
    observeAllTurns();
}

function processBlock(turnId, responseElement) {
    const textElement = responseElement.querySelector('.markdown-main-panel, .markdown, .message-content');
    // If no text element, check if there are images directly in the response container
    const hasImage = responseElement.querySelector('img') !== null;
    
    // We need at least text element or image
    if (!textElement && !hasImage) return;

    let content = textElement ? textElement.innerText.trim() : '';
    
    // Proceed if content is long enough OR if there is an image
    if ((!content || content.length < 10) && !hasImage) return; 

    // Truncate AI response to 3000 characters to optimize API usage
    if (content.length > 3000) {
        content = content.substring(0, 3000) + '...';
    }

    if (!messageBlocks.has(turnId) || messageBlocks.get(turnId).status === 'error') {
        console.log(`New block detected: ${turnId} (hasImage: ${hasImage})`);
        
        // Attempt to find user query for context
        const turnContainer = responseElement.closest('.conversation-container') || responseElement.parentElement;
        const userPrompt = getUserQuery(turnContainer);
        
        messageBlocks.set(turnId, { title: null, subtitles: [], status: 'loading' });
        requestSummary(turnId, content, userPrompt, hasImage);
        updateToCUI();
    }
}

function getUserQuery(turnElement) {
    if (!turnElement) return '';
    
    let rawText = '';

    // Strategy 1: Look for specific user content classes
    const userContent = turnElement.querySelector('.user-query, .query-content, .user-content');
    if (userContent) {
        rawText = userContent.innerText.trim();
    } else {
        // Strategy 2: Look for 'user-message' tag or attribute
        const userMessage = turnElement.querySelector('user-message');
        if (userMessage) {
            rawText = userMessage.innerText.trim();
        }
    }

    // Strategy 3: (Fallback) - Already handled by returning empty if above fails, 
    // or could be improved, but let's stick to reliable selectors first.

    if (!rawText) return '';

    // Truncate to 100 characters as requested
    return rawText.length > 100 ? rawText.substring(0, 100) + '...' : rawText;
}

function requestSummary(turnId, content, userPrompt, hasImage) {
    if (!chrome.runtime || !chrome.runtime.id) {
        console.warn('Extension context invalidated. Please refresh the page.');
        return;
    }

    try {
        chrome.runtime.sendMessage({
            type: 'SUMMARIZE_BLOCK',
            turnId: turnId,
            content: content,
            userPrompt: userPrompt,
            hasImage: hasImage
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('Runtime error:', chrome.runtime.lastError.message);
                return;
            }
            
            if (response && response.summary) {
                console.log(`Summary received for ${turnId}:`, response.summary);
                messageBlocks.set(turnId, { ...response.summary, status: 'success' });
                updateToCUI();
            } else if (response && response.error) {
                console.error(`Summary error for ${turnId}:`, response.error);
                messageBlocks.set(turnId, { title: 'Error generating title', subtitles: [], status: 'error' });
                updateToCUI();
            }
        });
    } catch (e) {
        console.error('Failed to send message:', e);
    }
}

// --- Observer logic ---

let activeScrollObserver = null;
const observedTurns = new Set();

function initActiveScrollObserver() {
    const options = {
        root: null,
        rootMargin: '-10% 0px -70% 0px',
        threshold: 0
    };

    activeScrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const turnId = entry.target.id;
                if (turnId) {
                    setActiveTocItem(turnId);
                }
            }
        });
    }, options);

    // Handle edge case: when scrolled to top, activate first item
    const scrollContainer = document.querySelector('.chat-history') || 
                           document.querySelector('infinite-scroller') || 
                           window;
    
    const scrollTarget = scrollContainer === window ? document.documentElement : scrollContainer;
    
    let isThrottled = false;
    scrollContainer.addEventListener('scroll', () => {
        if (isThrottled) return;
        isThrottled = true;
        
        setTimeout(() => {
            const scrollTop = scrollContainer === window ? window.scrollY : scrollContainer.scrollTop;
            if (scrollTop < 100) {
                const firstTocItem = document.querySelector('.toc-item');
                if (firstTocItem) {
                    const firstTurnId = firstTocItem.getAttribute('data-turn-id');
                    if (firstTurnId) {
                        setActiveTocItem(firstTurnId);
                    }
                }
            }
            isThrottled = false;
        }, 100);
    });
    
    observeAllTurns();
}

function setActiveTocItem(turnId) {
    if (!turnId) return;
    currentActiveTurnId = turnId;

    let activeEl = null;
    document.querySelectorAll('.toc-item').forEach(el => {
        if (el.getAttribute('data-turn-id') === turnId) {
            el.classList.add('active');
            activeEl = el;
        } else {
            el.classList.remove('active');
        }
    });

    if (activeEl) {
        // Ensure the active item is visible within the scrollable container
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function observeAllTurns() {
    if (!activeScrollObserver) return;
    
    document.querySelectorAll('.conversation-container').forEach(turn => {
        if (turn.id && !observedTurns.has(turn.id)) {
            activeScrollObserver.observe(turn);
            observedTurns.add(turn.id);
        }
    });
}

function initObserver() {
    console.log('Gemini ToC: Initializing MutationObserver...');
    
    // Create container immediately if not exists
    createToCContainer();

    const target = document.querySelector('.chat-history') || 
                   document.querySelector('infinite-scroller') || 
                   document.querySelector('main') || 
                   document.body;
    
    chatObserver = new MutationObserver((mutations) => {
        clearTimeout(window.tocDebounce);
        window.tocDebounce = setTimeout(processNewMessages, 500);
    });

    chatObserver.observe(target, { childList: true, subtree: true });
    
    processNewMessages();
    initActiveScrollObserver();
}

// Initialize immediately
function init() {
    createToCContainer();
    initObserver();
    initUrlChangeDetection();
    
    // Initial check in case content is already there
    processNewMessages();
    initActiveScrollObserver();
}

// Detect URL changes (chat switching) and reset ToC
let lastUrl = location.href;
function initUrlChangeDetection() {
    // Check for URL changes periodically (for SPA navigation)
    setInterval(() => {
        if (location.href !== lastUrl) {
            console.log('Gemini ToC: Chat changed, resetting ToC...');
            lastUrl = location.href;
            resetToC();
        }
    }, 500);
    
    // Also listen for popstate (browser back/forward)
    window.addEventListener('popstate', () => {
        if (location.href !== lastUrl) {
            console.log('Gemini ToC: Navigation detected, resetting ToC...');
            lastUrl = location.href;
            resetToC();
        }
    });
}

function resetToC() {
    messageBlocks.clear();
    observedTurns.clear();
    isTocRequested = false; // Reset request state for new chat
    updateToCUI();
    
    // Re-process after a short delay to allow new chat to load
    setTimeout(() => {
        processNewMessages();
    }, 1000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
