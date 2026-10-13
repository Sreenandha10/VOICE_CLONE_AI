// static/js/index.js
// Global state
let uploadedFiles = [];
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
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
        item.addEventListener('click', function() {
            const sectionId = this.getAttribute('data-section');
            
            // Update active states
            sidebarItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            
            // Show corresponding section
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `${sectionId}-section`) {
                    section.classList.add('active');
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
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', function() {
        this.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('dragover');
        const files = e.dataTransfer.files;
        handleFileUpload(files);
    });
    
    // File input change
    fileInput.addEventListener('change', function() {
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
            alert(`Unsupported audio file formats: ${data.errors.join(', ')}. Please upload only WAV, FLAC, or OGG files.`);
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
    switch(quality.toLowerCase()) {
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
            
            // Update button to show submit
            const actionsDiv = fileCard.querySelector('.file-actions');
            actionsDiv.innerHTML = `
                <button class="submit-button" 
                        data-filename="${filename}"
                        data-emotion="${button.dataset.emotion || 'neutral'}">
                    📤 Submit to Database
                </button>
            `;
            
            // Add submit listener
            const submitBtn = actionsDiv.querySelector('.submit-button');
            submitBtn.addEventListener('click', () => handleSubmit(filename, submitBtn, button.dataset.emotion || 'neutral'));
            
            // Update global state
            uploadedFiles = uploadedFiles.map(f => 
                f.filename === filename ? { ...f, quality: 'Enhanced', enhanced: true, needs_enhancement: false } : f
            );
            
            updateVoiceSelector();
        } else {
            alert('Enhancement failed. Please try again.');
        }
    } catch (error) {
        console.error('Enhancement error:', error);
        alert('Enhancement failed. Please try again.');
    } finally {
        button.disabled = false;
        button.textContent = '✨ Enhanced!';
        setTimeout(() => {
            button.remove();
        }, 2000);
    }
}

// Handle Submit to Database
async function handleSubmit(filename, button, emotion) {
    button.disabled = true;
    button.textContent = 'Submitting...';
    
    try {
        const response = await fetch('/submit-audio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename, emotion })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Update file card
            const fileCard = document.getElementById(`file-${filename}`);
            const actionsDiv = fileCard.querySelector('.file-actions');
            actionsDiv.innerHTML = `
                <div class="submitted-badge">
                    ✅ Submitted to Database
                </div>
            `;
            
            // Add summary if provided
            if (data.summary) {
                const summaryDiv = document.createElement('div');
                summaryDiv.className = 'file-summary';
                summaryDiv.innerHTML = `<strong>Summary:</strong> ${data.summary}`;
                fileCard.appendChild(summaryDiv);
            }
            
            // Update global state
            uploadedFiles = uploadedFiles.filter(f => f.filename !== filename);
            
            updateVoiceSelector();
            loadAudioFiles(); // Refresh summary
        } else {
            alert('Submission failed. Please try again.');
        }
    } catch (error) {
        console.error('Submit error:', error);
        alert('Submission failed. Please try again.');
    } finally {
        button.disabled = false;
    }
}

// Chatbot Setup
function setupChatbot() {
    const sendButton = document.getElementById('sendButton');
    const chatInput = document.getElementById('chatInput');
    const recordButton = document.getElementById('recordButton');
    const refreshVoices = document.getElementById('refreshVoices');
    
    // Send button
    sendButton.addEventListener('click', handleSend);
    
    // Enter key to send
    chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });
    
    // Record button
    recordButton.addEventListener('click', toggleRecording);
    
    // Refresh voices
    refreshVoices.addEventListener('click', updateVoiceSelector);
}

// Handle Send Button (Updated for TTS Response)
async function handleSend() {
    const chatInput = document.getElementById('chatInput');
    const voiceSelect = document.getElementById('voiceSelect');
    const text = chatInput.value.trim();
    const voice = voiceSelect.value;
    
    if (!text) return;
    
    // Add user message (pass as object for consistency)
    addMessage({ text }, 'user');
    chatInput.value = '';
    
    try {
        const response = await fetch('/chatbot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text, voice })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Add bot response with optional audio
            addMessage(data, 'bot');
        } else {
            addMessage('Sorry, there was an error processing your message.', 'bot');
        }
    } catch (error) {
        console.error('Chatbot error:', error);
        addMessage('Sorry, there was an error processing your message.', 'bot');
    }
}

// Create Audio Player HTML
function createAudioPlayer(audioUrl, filename) {
    return `
        <div class="audio-response">
            <audio controls class="response-audio" preload="auto">
                <source src="${audioUrl}" type="audio/wav">
                Your browser does not support the audio element.
            </audio>
            <button class="replay-button" data-audio="${audioUrl}" title="Replay">🔄</button>
            <p class="audio-filename">Generated: ${filename}</p>
        </div>
    `;
}

// Add replay listener helper
function setupReplayListeners() {
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('replay-button')) {
            const audioUrl = e.target.dataset.audio;
            const audio = new Audio(audioUrl);
            audio.play().catch(err => console.error('Replay error:', err));
        }
    });
}

// Add Message to Chat (Updated to Support Audio)
function addMessage(messageObj, type) {
    const chatMessages = document.getElementById('chatMessages');
    const welcomeMessage = chatMessages.querySelector('.welcome-message');
    
    if (welcomeMessage) {
        welcomeMessage.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    if (type === 'user') {
        // User message: just text
        messageDiv.textContent = messageObj.text || messageObj;
    } else {
        // Bot message: text + optional audio
        const textContent = messageObj.text || messageObj;
        messageDiv.innerHTML = `<p>${textContent}</p>`;
        
        if (messageObj.audio_url) {
            const playerHtml = createAudioPlayer(messageObj.audio_url, messageObj.voice);
            messageDiv.innerHTML += playerHtml;
            
            // Auto-play after a short delay (user interaction ensured by send button)
            setTimeout(() => {
                const audio = messageDiv.querySelector('.response-audio');
                if (audio) {
                    audio.play().catch(err => {
                        console.error('Auto-play failed (browser policy):', err);
                        // Fallback: just show controls
                    });
                }
            }, 500);
        }
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Setup replay listeners once
    setupReplayListeners();
}

// Toggle Recording
async function toggleRecording() {
    const recordButton = document.getElementById('recordButton');
    
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.addEventListener('dataavailable', event => {
                audioChunks.push(event.data);
            });
            
            mediaRecorder.addEventListener('stop', () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                // Here you can upload the audio blob or process it
                console.log('Recording stopped', audioBlob);
            });
            
            mediaRecorder.start();
            isRecording = true;
            recordButton.classList.add('recording');
            recordButton.title = 'Stop Recording';
        } catch (error) {
            console.error('Recording error:', error);
            alert('Failed to access microphone. Please check permissions.');
        }
    } else {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        recordButton.classList.remove('recording');
        recordButton.title = 'Record Voice';
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
                '<span class="submitted-badge">✅ In Database</span><br>' : 
                '<span class="pending-badge">⏳ Pending Submission</span><br>'
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

// Handle Submit from Summary
async function handleSubmitFromSummary(filename, button, emotion) {
    // Reuse handleSubmit logic
    handleSubmit(filename, button, emotion);
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
        
        // Also add current session uploaded files (for immediate use)
        uploadedFiles.forEach(file => {
            const option = document.createElement('option');
            option.value = file.filename;
            const cleanName = file.original_name || file.filename.split('_').slice(1).join('_').replace('.wav', '') || file.filename;
            option.textContent = `${cleanName} (${getEmotionEmoji(file.emotion || 'neutral')} ${file.emotion || 'Neutral'}) - ${file.quality} [Session]`;
            voiceSelect.appendChild(option);
        });
        
    } catch (error) {
        console.error('Failed to load voices from database:', error);
        
        // Fallback to session files only
        uploadedFiles.forEach(file => {
            const option = document.createElement('option');
            option.value = file.filename;
            option.textContent = `${file.original_name || file.filename} (${getEmotionEmoji(file.emotion || 'neutral')} ${file.emotion || 'Neutral'}) - ${file.quality}`;
            voiceSelect.appendChild(option);
        });
    }
}