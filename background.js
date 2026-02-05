// Background Service Worker: API calls and storage management
console.log('Gemini ToC Background Worker loaded.');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SUMMARIZE_BLOCK') {
        handleSummarizeRequest(request.content, request.userPrompt, request.hasImage, sendResponse);
        return true; // Keep channel open for async response
    }
});

async function handleSummarizeRequest(content, userPrompt, hasImage, sendResponse) {
    console.log('Gemini ToC: Starting summarization request...');
    try {
        const settings = await chrome.storage.local.get(['geminiApiKey']);
        const apiKey = settings.geminiApiKey;

        if (!apiKey) {
            console.error('Gemini ToC: API Key is missing.');
            sendResponse({ error: 'Settings에서 API Key를 먼저 설정해주세요.' });
            return;
        }

        const userContextSection = userPrompt ? `
            User Question:
            """
            ${userPrompt}
            """
        ` : '';
        
        const imageContextSection = hasImage ? `
            Note: The response includes a generated IMAGE which is not visible in the text block below.
        ` : '';

        const imageGuideline = hasImage ? `
            5. Special Image Rule: Since an image is present, the Title MUST start with "[이미지] : " followed by a summary of the user's question or topic.
               - Example: "[이미지] : 2024년 4분기 매출 차트"
        ` : '';

        const prompt = `
            You are an expert editor creating a structured Table of Contents for a chat assistant.
            ${userContextSection}
            ${imageContextSection}
            Chat Block to Summarize:
            """
            ${content}
            """
            
            Guidelines:
            1. Title: Create a professional, clear, and catchy title (max 10 words).
            2. Subtitles: Extract the most important specific sub-topics, findings, or sections. 
               - Each sub-point should be 5-10 words long.
               - Provide 2 to 4 sub-points depending on the richness of the content.
               - Capture specific insights rather than generic headers (e.g., instead of "Security Tips", use "Safety tips: avoid simple patterns and use biometric auth").
            3. Accuracy: Ensure the sub-points reflect the actual structure (1., 2., 3...) of the message if it has one.
            4. Language: STRICTLY respond in the SAME language as the provided text (e.g., Korean input -> Korean output).
            ${imageGuideline}
            
            Return ONLY a valid JSON object in the following format (no markdown code blocks):
            {
                "title": "Main Topic",
                "subtitles": ["Specific Detail 1", "Specific Detail 2", "Specific Detail 3"]
            }
        `;

        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            let errorMessage = `API Error ${response.status}`;
            
            if (response.status === 429) {
                errorMessage = 'API 사용량이 초과되었습니다 (Quota Exceeded). 잠시 후 다시 시도하거나, 다른 API 키를 사용해주세요.';
            } else {
                try {
                    const errData = JSON.parse(errBody);
                    errorMessage = errData.error?.message || errorMessage;
                } catch (e) {}
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log('Gemini ToC: API Response Data:', data);
        
        if (!data.candidates || data.candidates.length === 0) {
            if (data.promptFeedback?.blockReason) {
                throw new Error(`AI가 내용을 차단했습니다 (이유: ${data.promptFeedback.blockReason})`);
            }
            throw new Error('AI 응답 후보(candidates)가 없습니다.');
        }

        const candidate = data.candidates[0];
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
             console.warn('Gemini ToC: Non-STOP finish reason:', candidate.finishReason);
        }

        const rawText = candidate.content?.parts?.[0]?.text;
        if (!rawText) {
            if (candidate.finishReason === 'SAFETY') {
                throw new Error('안전 정책에 의해 답변 생성이 중단되었습니다.');
            }
            throw new Error('AI 응답 텍스트를 찾을 수 없습니다.');
        }

        console.log('Gemini ToC: Raw text from AI:', rawText);
        
        // Find JSON block with regex
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('Gemini ToC: Failed to find JSON in:', rawText);
            throw new Error('요약 결과에서 데이터 형식을 찾을 수 없습니다.');
        }

        const cleanJsonText = jsonMatch[0];
        try {
            const result = JSON.parse(cleanJsonText);
            if (result && result.title) {
                sendResponse({ summary: result });
            } else {
                throw new Error('요약 데이터의 형식이 올바르지 않습니다.');
            }
        } catch (parseError) {
            console.error('Gemini ToC: JSON Parse Error:', parseError, 'text:', cleanJsonText);
            throw new Error('AI 응답 해석 중 오류가 발생했습니다.');
        }

    } catch (error) {
        console.error('Summarization Detailed Error:', error);
        sendResponse({ error: error.message });
    }
}
