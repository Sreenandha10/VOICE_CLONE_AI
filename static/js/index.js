// static/js/index.js
// Global state
let uploadedFiles = [];
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let currentAudioUrlToShare = null;
let selectedShareUsers = new Set();

// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
    initializeApp();
});

function initializeApp() {
    setupSidebarNavigation();
    setupFileUpload();
    setupChatbot();
    loadAudioFiles();
    updateVoiceSelector(); // Load voices from database on startup
}

// Sidebar Navigation
function setupSidebarNavigation() {
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    const sections = document.querySelectorAll('.content-section');

    sidebarItems.forEach(item => {
        item.addEventListener('click', function () {
            const sectionId = this.getAttribute('data-section');

            // Update active states
            sidebarItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');

            // Show corresponding section
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `${sectionId}-section`) {
                    section.classList.add('active');
                    if (sectionId === 'shared') {
                        loadSharedMessages();
                    }
                }
            });
        });
    });
}

// Mobile Menu Toggle
function toggleMobileMenu() {
    const mobileMenu = document.getElementById('mobileMenu');
    mobileMenu.classList.toggle('active');
}

// File Upload Setup
function setupFileUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    // Drag and drop
    uploadArea.addEventListener('dragover', function (e) {
        e.preventDefault();
        this.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', function () {
        this.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('dragover');
        const files = e.dataTransfer.files;
        handleFileUpload(files);
    });

    // File input change
    fileInput.addEventListener('change', function () {
        handleFileUpload(this.files);
    });
}

// Handle File Upload
async function handleFileUpload(files) {
    if (files.length === 0) return;

    const uploadProgress = document.getElementById('uploadProgress');
    const filesGrid = document.getElementById('filesGrid');
    const emotionSelect = document.getElementById('emotionSelect');
    const selectedEmotion = emotionSelect.value;

    // Show progress animation
    uploadProgress.style.display = 'block';

    const formData = new FormData();
    for (let file of files) {
        formData.append('files[]', file);
    }
    formData.append('emotion', selectedEmotion); // Add selected emotion to form data

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.errors && data.errors.length > 0) {
            alert(`Unsupported audio file formats: ${data.errors.join(', ')}. Please upload only WAV, FLAC, OGG, or WebM files.`);
        }

        if (data.files && data.files.length > 0) {
            console.log('Upload successful, files:', data.files);
            // Add emotion to each file object
            data.files.forEach(file => {
                file.emotion = selectedEmotion;
            });
            uploadedFiles.push(...data.files);
            renderFiles(data.files, filesGrid);
            updateVoiceSelector(); // Update voice selector with new files
            loadAudioFiles(); // Refresh summary
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload files. Please try again.');
    } finally {
        // Hide progress animation
        setTimeout(() => {
            uploadProgress.style.display = 'none';
        }, 1000);
    }
}

// Render Files
function renderFiles(files, container) {
    files.forEach(file => {
        const fileCard = createFileCard(file);
        container.insertAdjacentHTML('beforeend', fileCard);

        // Add button listeners
        setTimeout(() => {
            const enhanceBtn = container.querySelector(`.enhance-button[data-filename="${file.filename}"]`);
            const submitBtn = container.querySelector(`.submit-button[data-filename="${file.filename}"]`);

            if (enhanceBtn) {
                enhanceBtn.addEventListener('click', () => handleEnhance(file.filename, enhanceBtn));
            }

            if (submitBtn) {
                submitBtn.addEventListener('click', () => handleSubmit(file.filename, submitBtn, file.emotion));
            }
        }, 100);
    });
}

// Create File Card HTML
function createFileCard(file) {
    const emotionEmoji = getEmotionEmoji(file.emotion || 'neutral');
    const qualityClass = getQualityClass(file.quality);
    const needsEnhancement = file.needs_enhancement || false;
    const isEnhanced = file.enhanced || file.quality === 'Enhanced';
    const isSubmitted = file.submitted || false;

    return `
        <div class="file-card" id="file-${file.filename}">
            <div class="file-header">
                <span class="file-icon">🎵</span>
                <span class="file-name" title="${file.original_name || file.filename}">${file.original_name || file.filename}</span>
                <span class="emotion-badge">${emotionEmoji} ${file.emotion || 'Neutral'}</span>
            </div>
            <audio controls class="audio-player">
                <source src="/uploads/${file.filename}" type="audio/wav">
                Your browser does not support the audio element.
            </audio>
            <div class="file-details">
                <div class="detail-item">
                    <span class="detail-label">Duration</span>
                    <span class="detail-value">${file.duration}s</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Size</span>
                    <span class="detail-value">${file.file_size} KB</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Quality</span>
                    <span class="detail-value">
                        <span class="quality-badge ${qualityClass}">${file.quality}</span>
                        ${file.quality_score ? `<span class="quality-score">(${file.quality_score}/100)</span>` : ''}
                    </span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Sample Rate</span>
                    <span class="detail-value">${file.sample_rate} Hz</span>
                </div>
            </div>
            <div class="file-actions">
                ${!isEnhanced && !isSubmitted ? `
                    <button class="enhance-button ${needsEnhancement ? 'required' : 'optional'}" 
                            data-filename="${file.filename}"
                            data-emotion="${file.emotion || 'neutral'}">
                        ${needsEnhancement ? '⚠️ Enhance Required' : '✨ Enhance (Optional)'}
                    </button>
                ` : ''}
                ${isEnhanced && !isSubmitted ? `
                    <button class="submit-button" 
                            data-filename="${file.filename}"
                            data-emotion="${file.emotion || 'neutral'}">
                        📤 Submit to Database
                    </button>
                ` : ''}
                ${!needsEnhancement && !isEnhanced && !isSubmitted ? `
                    <button class="submit-button" 
                            data-filename="${file.filename}"
                            data-emotion="${file.emotion || 'neutral'}">
                        📤 Submit to Database
                    </button>
                ` : ''}
                ${isSubmitted ? `
                    <div class="submitted-badge">
                        ✅ Submitted to Database
                    </div>
                ` : ''}
            </div>
            ${file.summary ? `
                <div class="file-summary">
                    <strong>Summary:</strong> ${file.summary}
                </div>
            ` : ''}
        </div>
    `;
}

// Get Quality Class for styling
function getQualityClass(quality) {
    switch (quality.toLowerCase()) {
        case 'high': return 'high';
        case 'medium': return 'medium';
        case 'low': return 'low';
        case 'enhanced': return 'enhanced';
        default: return 'unknown';
    }
}

// Get Emotion Emoji
function getEmotionEmoji(emotion) {
    const emojis = {
        neutral: '😐',
        happy: '😊',
        sad: '😢',
        angry: '😠',
        excited: '🤩',
        afraid: '😨',
        disgusted: '🤢',
        calm: '😌',
        surprised: '😲'
    };
    return emojis[emotion] || '😐';
}

// Handle Audio Enhancement
async function handleEnhance(filename, button) {
    button.disabled = true;
    button.textContent = 'Processing...';

    try {
        const response = await fetch('/enhance', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename })
        });

        const data = await response.json();

        if (data.success) {
            // Update file card with enhanced status
            const fileCard = document.getElementById(`file-${filename}`);
            const qualityBadge = fileCard.querySelector('.quality-badge');
            qualityBadge.textContent = 'Enhanced';
            qualityBadge.className = 'quality-badge enhanced';

            // Update button to show submit option
            const fileActions = fileCard.querySelector('.file-actions');
            fileActions.innerHTML = `
                <button class="submit-button" 
                        data-filename="${filename}"
                        data-emotion="${button.dataset.emotion}">
                    📤 Submit to Database
                </button>
            `;

            // Add submit button listener
            const submitBtn = fileActions.querySelector('.submit-button');
            submitBtn.addEventListener('click', () => handleSubmit(filename, submitBtn, button.dataset.emotion));

            // Update in uploadedFiles array
            const fileIndex = uploadedFiles.findIndex(f => f.filename === filename);
            if (fileIndex !== -1) {
                uploadedFiles[fileIndex].enhanced = true;
                uploadedFiles[fileIndex].quality = 'Enhanced';
                uploadedFiles[fileIndex].needs_enhancement = false;
            }

            // Reload audio player
            const audioPlayer = fileCard.querySelector('audio');
            audioPlayer.load();

            // Refresh summary
            loadAudioFiles();
        } else {
            throw new Error(data.error || 'Enhancement failed');
        }
    } catch (error) {
        console.error('Enhancement error:', error);
        alert('Failed to enhance audio. Please try again.');
        button.disabled = false;
        button.textContent = button.classList.contains('required') ? '⚠️ Enhance Required' : '✨ Enhance (Optional)';
    }
}

// Handle Audio Submission
async function handleSubmit(filename, button, emotion) {
    button.disabled = true;
    button.textContent = 'Submitting...';

    try {
        const response = await fetch('/submit-audio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: filename,
                emotion: emotion
            })
        });

        const data = await response.json();

        if (data.success) {
            // Update file card with submitted status
            const fileCard = document.getElementById(`file-${filename}`);
            const fileActions = fileCard.querySelector('.file-actions');
            fileActions.innerHTML = `
                <div class="submitted-badge">
                    ✅ Submitted to Database
                </div>
            `;

            // Add summary if available
            if (data.summary) {
                const existingSummary = fileCard.querySelector('.file-summary');
                if (!existingSummary) {
                    const summaryDiv = document.createElement('div');
                    summaryDiv.className = 'file-summary';
                    summaryDiv.innerHTML = `<strong>Summary:</strong> ${data.summary}`;
                    fileCard.appendChild(summaryDiv);
                }
            }

            // Update in uploadedFiles array
            const fileIndex = uploadedFiles.findIndex(f => f.filename === filename);
            if (fileIndex !== -1) {
                uploadedFiles[fileIndex].submitted = true;
                uploadedFiles[fileIndex].summary = data.summary;
            }

            // Refresh summary and voice selector
            loadAudioFiles();
            updateVoiceSelector();

            alert('Audio submitted successfully to database!');
        } else {
            throw new Error(data.error || 'Submission failed');
        }
    } catch (error) {
        console.error('Submission error:', error);
        alert('Failed to submit audio to database. Please try again.');
        button.disabled = false;
        button.textContent = '📤 Submit to Database';
    }
}

// Handle Audio Submission from Summary
async function handleSubmitFromSummary(filename, button, emotion) {
    button.disabled = true;
    button.textContent = 'Submitting...';

    try {
        const response = await fetch('/submit-audio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: filename,
                emotion: emotion
            })
        });

        const data = await response.json();

        if (data.success) {
            // Refresh summary and voice selector to show updated status
            loadAudioFiles();
            updateVoiceSelector();
            alert('Audio submitted successfully to database!');
        } else {
            throw new Error(data.error || 'Submission failed');
        }
    } catch (error) {
        console.error('Submission error:', error);
        alert('Failed to submit audio to database. Please try again.');
        button.disabled = false;
        button.textContent = '📤 Submit to Database';
    }
}

// Setup Chatbot
function setupChatbot() {
    const sendButton = document.getElementById('sendButton');
    const chatInput = document.getElementById('chatInput');
    const recordButton = document.getElementById('recordButton');
    const refreshVoicesBtn = document.getElementById('refreshVoices');

    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    recordButton.addEventListener('click', toggleRecording);
    refreshVoicesBtn.addEventListener('click', updateVoiceSelector);
}

// Send Message
async function sendMessage() {
    const chatInput = document.getElementById('chatInput');
    const voiceSelect = document.getElementById('voiceSelect');
    const chatMessages = document.getElementById('chatMessages');

    const text = chatInput.value.trim();
    const voice = voiceSelect.value;

    if (!text) return;

    // Add user message
    addMessage(text, 'user');
    chatInput.value = '';

    // Add loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-message';
    loadingDiv.className = 'message bot loading';
    loadingDiv.innerHTML = `
        <div class="spinner"></div>
        <span>Generating cloned voice audio...</span>
    `;
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const response = await fetch('/chatbot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text, voice })
        });

        const data = await response.json();

        // Remove loading indicator
        if (loadingDiv.parentNode) {
            loadingDiv.parentNode.removeChild(loadingDiv);
        }

        if (data.success) {
            // Add bot response with audio player if available
            if (data.audio_url) {
                addMessageWithAudio(data.text, data.audio_url, 'bot');
            } else {
                addMessage(`Received: "${data.text}"${voice ? ` (Voice: ${voice})` : ''}`, 'bot');
            }
        } else {
            addMessage(`Error: ${data.error}`, 'bot');
        }
    } catch (error) {
        console.error('Chatbot error:', error);
        // Remove loading
        if (loadingDiv.parentNode) {
            loadingDiv.parentNode.removeChild(loadingDiv);
        }
        addMessage('Sorry, there was an error processing your message.', 'bot');
    }
}

// Add Message to Chat (text only)
function addMessage(text, type) {
    const chatMessages = document.getElementById('chatMessages');
    const welcomeMessage = chatMessages.querySelector('.welcome-message');

    if (welcomeMessage) {
        welcomeMessage.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = text;

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add Message with Audio
function addMessageWithAudio(text, audioUrl, type) {
    const chatMessages = document.getElementById('chatMessages');
    const welcomeMessage = chatMessages.querySelector('.welcome-message');

    if (welcomeMessage) {
        welcomeMessage.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    // Create Container for Audio + Button
    const audioContainer = document.createElement('div');
    audioContainer.className = 'chat-audio-container';

    const audioPlayer = document.createElement('audio');
    audioPlayer.controls = true;
    audioPlayer.className = 'chat-audio-player';
    audioPlayer.style.flex = '1';
    audioPlayer.style.marginBottom = '0'; // override default

    const source = document.createElement('source');
    source.src = audioUrl;
    source.type = 'audio/wav';
    audioPlayer.appendChild(source);

    audioContainer.appendChild(audioPlayer);

    // Add Share Button for Bot messages
    if (type === 'bot') {
        const shareBtn = document.createElement('button');
        shareBtn.className = 'share-button';
        shareBtn.innerHTML = '<i class="fas fa-share-alt"></i> Share';
        shareBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent bubbling issues
            openShareModal(audioUrl);
        };
        audioContainer.appendChild(shareBtn);
    }

    messageDiv.appendChild(textSpan);
    messageDiv.appendChild(audioContainer);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Toggle Recording for Live Voice Cloning Sample
async function toggleRecording() {
    const recordButton = document.getElementById('recordButton');
    const voiceSelect = document.getElementById('voiceSelect');

    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            audioChunks = [];

            mediaRecorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            });

            mediaRecorder.addEventListener('stop', async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

                if (audioBlob.size === 0) {
                    alert('No audio recorded. Please try again.');
                    return;
                }

                // Upload for processing as voice sample
                const formData = new FormData();
                formData.append('audio', audioBlob, 'live_recording.webm');

                try {
                    const response = await fetch('/record-voice', {
                        method: 'POST',
                        body: formData
                    });

                    const data = await response.json();

                    if (data.success && data.file) {
                        // Add the new file to uploadedFiles
                        uploadedFiles.push(data.file);

                        // Update voice selector and select the new voice
                        updateVoiceSelector();
                        voiceSelect.value = data.file.filename;

                        // Optionally refresh files grid and summary
                        const filesGrid = document.getElementById('filesGrid');
                        renderFiles([data.file], filesGrid);
                        loadAudioFiles();

                        alert('Live voice sample recorded and ready for cloning!');
                    } else {
                        console.error('Recording processing failed:', data.error);
                        alert('Failed to process recording. Please try again.');
                    }
                } catch (error) {
                    console.error('Recording upload error:', error);
                    alert('Failed to upload recording. Please check your connection.');
                }

                // Stop stream
                stream.getTracks().forEach(track => track.stop());
            });

            mediaRecorder.start();
            isRecording = true;
            recordButton.classList.add('recording');
            recordButton.title = 'Stop Recording (for voice cloning sample)';
        } catch (error) {
            console.error('Recording error:', error);
            alert('Failed to access microphone. Please check permissions.');
        }
    } else {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        isRecording = false;
        recordButton.classList.remove('recording');
        recordButton.title = 'Record Live Voice Sample';
    }
}

// Load Audio Files for Summary
async function loadAudioFiles() {
    try {
        console.log('Loading audio files for summary...');
        const response = await fetch('/get-all-audio-files');
        const data = await response.json();

        console.log('Audio files response:', data);

        if (data.files && data.files.length > 0) {
            console.log(`Found ${data.files.length} files for summary`);
            renderSummary(data.files);
        } else {
            console.log('No files found for summary');
            renderSummary([]);
        }
    } catch (error) {
        console.error('Failed to load audio files:', error);
    }
}

// Render Summary
function renderSummary(files) {
    const summaryGrid = document.getElementById('summaryGrid');

    if (files.length === 0) {
        summaryGrid.innerHTML = `
            <div class="empty-state">
                <p>📁 No audio files uploaded yet</p>
                <p class="empty-subtext">Upload audio files to see summaries here</p>
            </div>
        `;
        return;
    }

    summaryGrid.innerHTML = '';

    files.forEach(file => {
        const summaryCard = createSummaryCard(file);
        summaryGrid.insertAdjacentHTML('beforeend', summaryCard);

        // Add submit button listener for non-submitted files
        if (!file.submitted) {
            setTimeout(() => {
                const submitBtn = summaryGrid.querySelector(`.submit-from-summary-button[data-filename="${file.filename}"]`);
                if (submitBtn) {
                    submitBtn.addEventListener('click', () => handleSubmitFromSummary(file.filename, submitBtn, file.emotion));
                }
            }, 100);
        }
    });
}

// Create Summary Card HTML
function createSummaryCard(file) {
    const summary = file.summary || generateSummary(file);
    const emotionEmoji = getEmotionEmoji(file.emotion || 'neutral');
    const qualityClass = getQualityClass(file.quality);
    const isSubmitted = file.submitted || false;

    return `
        <div class="summary-card">
         ${isSubmitted ?
            '<span class="submitted-badge">✅ In Database</span>  </br>' :
            '<span class="pending-badge">⏳ Pending Submission</span> </br>'
        }
            <div class="summary-header">
                <span class="summary-icon">🎵</span>
                <span class="summary-title">${file.filename} ${emotionEmoji} ${file.emotion || 'Neutral'}</span>
            </div>
            <audio controls class="audio-player">
                <source src="/uploads/${file.filename}" type="audio/wav">
            </audio>
            <p class="summary-description">${summary}</p>
            <div class="summary-stats">
                <div class="detail-item">
                    <span class="detail-label">Duration</span>
                    <span class="detail-value">${file.duration}s</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Size</span>
                    <span class="detail-value">${file.file_size} KB</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Quality</span>
                    <span class="detail-value">
                        <span class="quality-badge ${qualityClass}">${file.quality}</span>
                    </span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Sample Rate</span>
                    <span class="detail-value">${file.sample_rate} Hz</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Uploaded</span>
                    <span class="detail-value">${file.created_at || 'Unknown'}</span>
                </div>
            </div>
            ${!isSubmitted ? `
                <div class="summary-actions">
                    <button class="submit-from-summary-button" 
                            data-filename="${file.filename}"
                            data-emotion="${file.emotion || 'neutral'}">
                        📤 Submit to Database
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

// Generate Summary
function generateSummary(file) {
    const duration = file.duration;
    const quality = file.quality;
    const sampleRate = file.sample_rate;

    let summary = `Audio file with ${duration.toFixed(1)} seconds duration. `;

    if (quality === 'Enhanced') {
        summary += `This file has been enhanced with AI-powered noise reduction for improved clarity. `;
    }

    summary += `Recorded at ${sampleRate} Hz sample rate, providing ${sampleRate >= 44100 ? 'high' : 'standard'} quality audio suitable for voice applications.`;

    return summary;
}

// Update Voice Selector
async function updateVoiceSelector() {
    const voiceSelect = document.getElementById('voiceSelect');

    // Clear existing options except first
    voiceSelect.innerHTML = '<option value="">No voice selected</option>';

    try {
        // Load voices from database
        const response = await fetch('/get-user-voices');
        const data = await response.json();

        if (data.voices && data.voices.length > 0) {
            console.log('Loading voices from database:', data.voices);
            data.voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.filename;
                // Extract a cleaner name from filename
                const cleanName = voice.filename.split('_').slice(1).join('_').replace('.wav', '') || voice.filename;
                option.textContent = `${cleanName} (${getEmotionEmoji(voice.emotion || 'neutral')} ${voice.emotion || 'Neutral'}) - ${voice.quality}`;
                voiceSelect.appendChild(option);
            });
        } else {
            console.log('No voices found in database');
        }

        // Also add current session uploaded files (for immediate use, including live recordings)
        uploadedFiles.forEach(file => {
            if (!file.submitted) {  // Only non-submitted for session use
                const option = document.createElement('option');
                option.value = file.filename;
                const cleanName = file.original_name || file.filename.split('_').slice(1).join('_').replace('.wav', '') || file.filename;
                option.textContent = `${cleanName} (${getEmotionEmoji(file.emotion || 'neutral')} ${file.emotion || 'Neutral'}) - ${file.quality} [Session]`;
                voiceSelect.appendChild(option);
            }
        });

    } catch (error) {
        console.error('Failed to load voices from database:', error);

        // Fallback to session files only
        uploadedFiles.forEach(file => {
            const option = document.createElement('option');
            option.value = file.filename;
            const cleanName = file.original_name || file.filename.split('_').slice(1).join('_').replace('.wav', '') || file.filename;
            option.textContent = `${cleanName} (${getEmotionEmoji(file.emotion || 'neutral')} ${file.emotion || 'Neutral'}) - ${file.quality}`;
            voiceSelect.appendChild(option);
        });
    }
}

// --- Share Feature Logic ---

function openShareModal(audioUrl) {
    currentAudioUrlToShare = audioUrl;
    selectedShareUsers.clear();
    document.getElementById('shareModal').classList.remove('hidden');

    // Setup Search Listener
    const searchInput = document.getElementById('share-user-search');
    searchInput.oninput = (e) => searchUsersForShare(e.target.value);

    // Initial Load (All users or top 10)
    searchUsersForShare('');
}

function closeShareModal() {
    document.getElementById('shareModal').classList.add('hidden');
    currentAudioUrlToShare = null;
    selectedShareUsers.clear();
}

async function searchUsersForShare(query) {
    const list = document.getElementById('share-user-list');

    try {
        const response = await fetch('/search-users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        });
        const data = await response.json();

        list.innerHTML = '';
        if (data.users) {
            data.users.forEach(user => {
                const div = document.createElement('div');
                div.className = 'p-2 border-b flex justify-between items-center hover:bg-gray-100 cursor-pointer';
                div.onclick = () => toggleUserSelection(user.id, div);

                const isSelected = selectedShareUsers.has(user.id);
                div.innerHTML = `
                    <span class="font-medium">${user.username}</span>
                    <span class="text-indigo-600">${isSelected ? 'Currently Selected' : ''}</span>
                    <input type="checkbox" ${isSelected ? 'checked' : ''} class="pointer-events-none">
                `;

                // Visual selection state
                if (isSelected) div.classList.add('bg-indigo-50');

                list.appendChild(div);
            });
        }
    } catch (e) {
        console.error("Search error", e);
    }
}

function toggleUserSelection(userId, divElement) {
    if (selectedShareUsers.has(userId)) {
        selectedShareUsers.delete(userId);
        divElement.querySelector('input').checked = false;
        divElement.classList.remove('bg-indigo-50');
        divElement.querySelector('.text-indigo-600').textContent = '';
    } else {
        selectedShareUsers.add(userId);
        divElement.querySelector('input').checked = true;
        divElement.classList.add('bg-indigo-50');
        divElement.querySelector('.text-indigo-600').textContent = 'Selected';
    }
}

async function confirmShare() {
    if (!currentAudioUrlToShare || selectedShareUsers.size === 0) {
        alert("Please select users to share with.");
        return;
    }

    try {
        const response = await fetch('/share-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio_url: currentAudioUrlToShare,
                recipient_ids: Array.from(selectedShareUsers)
            })
        });

        const data = await response.json();
        if (data.success) {
            alert("Audio shared successfully!");
            closeShareModal();
        } else {
            alert("Failed to share: " + data.error);
        }
    } catch (e) {
        console.error("Share error", e);
        alert("Error sharing audio.");
    }
}

async function loadSharedMessages() {
    const grid = document.getElementById('sharedGrid');
    grid.innerHTML = '<p class="text-gray-500">Loading...</p>';

    try {
        const response = await fetch('/get-shared-history');
        const data = await response.json();

        grid.innerHTML = '';

        if (data.shared_items && data.shared_items.length > 0) {
            data.shared_items.forEach(item => {
                const card = document.createElement('div');
                card.className = "bg-white p-4 rounded shadow mb-2 border";
                card.innerHTML = `
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-bold text-gray-700">From: ${item.sender_name}</span>
                        <span class="text-xs text-gray-500">${item.created_at}</span>
                    </div>
                    <audio controls src="/uploads/${item.audio_url}" class="w-full h-8 mb-2"></audio>
                `;
                grid.appendChild(card);
            });
        } else {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>📭 No shared messages yet</p>
                </div>
            `;
        }
    } catch (e) {
        grid.innerHTML = '<p class="text-red-500">Error loading shared messages.</p>';
        console.error(e);
    }
}