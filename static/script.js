// Initialize Socket.IO connection
const socket = io();

// Storage key for chat history
const HISTORY_STORAGE_KEY = 'aiStudioChatHistory';

// Get references to DOM elements
const chatMessages = document.getElementById('chat-messages');
const modelSelector = document.getElementById('model-selector');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const recordButton = document.getElementById('record-button');

// Get references to webcam elements
const webcamFeed = document.getElementById('webcam-feed');
const captureButton = document.getElementById('capture-button');
const captureCanvas = document.getElementById('capture-canvas');

// Available models from the server
const AVAILABLE_MODELS = ["gemini-1.5-flash-001", "gemini-1.5-pro-preview-0514"];

// Recording state variables
let isRecording = false;
let mediaRecorder;
let audioChunks = [];
let audioMimeType = '';

// Variable to accumulate streamed response chunks
let currentResponseText = '';
// Reference to the current AI response container being updated
let currentResponseContainer = null;

// Load chat history from localStorage
function loadChatHistory() {
    try {
        const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (savedHistory) {
            const history = JSON.parse(savedHistory);
            history.forEach(message => {
                addMessage(message.text, message.isUser, false);
            });
        }
    } catch (error) {
        console.error('Error loading chat history:', error);
    }
}

// Populate model selector dropdown
function populateModelSelector() {
    // Clear the dropdown first to prevent duplicates
    modelSelector.innerHTML = '';
    
    // Add options for each available model
    AVAILABLE_MODELS.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelector.appendChild(option);
    });
}

// Add a message to the chat display and save to history
function addMessage(text, isUser = false, saveToHistory = true) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(isUser ? 'user-message' : 'ai-message');
    messageElement.textContent = text;
    chatMessages.appendChild(messageElement);
    
    // Scroll to the bottom of the chat
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Save to localStorage if needed
    if (saveToHistory) {
        try {
            const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
            const history = savedHistory ? JSON.parse(savedHistory) : [];
            history.push({ text, isUser });
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
        } catch (error) {
            console.error('Error saving to chat history:', error);
        }
    }
}

// Create a new AI response container that can be updated with streaming content
function createAIResponseContainer() {
    const responseElement = document.createElement('div');
    responseElement.classList.add('message', 'ai-message');
    chatMessages.appendChild(responseElement);
    
    // Store reference to the container we just created
    currentResponseContainer = responseElement;
    
    // Scroll to the bottom of the chat to ensure the new container is visible
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return responseElement;
}

/**
 * Send a message to the server
 * @param {string} [customMessage] - Optional custom message to send instead of using the input field
 */
function sendMessage(customMessage = null) {
    const message = customMessage || messageInput.value.trim();
    const selectedModel = modelSelector.value;
    
    if (message === '') return;
    
    // If this is from the input field (not from speech recognition)
    if (!customMessage) {
        // Display user message in the chat
        addMessage(message, true);
        
        // Clear input field
        messageInput.value = '';
    } else {
        // If it's from speech recognition, display as user message
        addMessage(message, true);
    }
    
    // Reset the current response text as we're starting a new conversation turn
    currentResponseText = '';
    
    // Create a container for the AI's response and store reference to it
    createAIResponseContainer();
    
    // Send message to server
    socket.emit('send_message', {
        message: message,
        model_name: selectedModel,
        history: [] // Empty for now, will be implemented later
    });
}

/**
 * Start recording audio from the microphone
 */
async function startRecording() {
    try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Determine the supported audio format
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            audioMimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
            audioMimeType = 'audio/ogg';
        } else {
            console.error('No supported audio MIME types found');
            return;
        }
        
        // Create MediaRecorder instance
        mediaRecorder = new MediaRecorder(stream);
        
        // Clear existing audio chunks
        audioChunks = [];
        
        // Handle data available event
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        // Handle recording stop event
        mediaRecorder.onstop = () => {
            // Create audio blob from chunks
            const audioBlob = new Blob(audioChunks, { type: audioMimeType });
            
            // Create a FileReader to convert blob to base64
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            
            reader.onloadend = () => {
                // Extract base64 data (remove the prefix)
                const base64Audio = reader.result.split(',')[1];
                
                // Send the audio to the server for speech-to-text
                sendAudioToServer(base64Audio, audioMimeType);
                
                // Stop all tracks in the stream to release the microphone
                stream.getTracks().forEach(track => track.stop());
            };
        };
        
        // Start recording
        mediaRecorder.start();
        
    } catch (error) {
        console.error('Error accessing microphone:', error);
        isRecording = false;
        recordButton.textContent = '🎤 Record';
    }
}

/**
 * Stop recording audio
 */
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}

/**
 * Send recorded audio to the server for speech-to-text processing
 * @param {string} base64Audio - Base64-encoded audio data
 * @param {string} mimeType - MIME type of the audio data
 */
async function sendAudioToServer(base64Audio, mimeType) {
    try {
        const response = await fetch('/stt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                audio_base64: base64Audio,
                mime_type: mimeType
            })
        });

        if (response.ok) {
            const data = await response.json();

            if (data.transcript && data.transcript.trim() !== '') {
                const transcript = data.transcript;
                
                // Display user's transcribed message
                addMessage(transcript, true);
                
                // Reset response text and create container for AI response
                currentResponseText = '';
                createAIResponseContainer();
                
                // Emit the transcript to the server
                socket.emit('send_message', {
                    message: transcript,
                    model_name: modelSelector.value,
                    history: [] // Empty for now
                });
            }
        } else {
            console.error('Failed to process audio:', response.statusText);
        }
    } catch (error) {
        console.error('Error sending audio to server:', error);
    }
}

/**
 * Initialize and start the webcam feed
 * Requests camera access and displays the feed in the video element
 */
async function setupWebcam() {
    // Disable the capture button until webcam is ready
    captureButton.disabled = true;
    
    // Check if the browser supports getUserMedia
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('Browser does not support accessing media devices');
        return;
    }
    
    try {
        // Request access to the webcam (video only)
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: false 
        });
        
        // Set the video source to the webcam stream
        webcamFeed.srcObject = stream;
        
        // Ensure the video starts playing (even though autoplay is set)
        webcamFeed.play();
        
        // Enable the capture button now that webcam is ready
        captureButton.disabled = false;
        
        console.log('Webcam initialized successfully');
    } catch (error) {
        console.error('Error accessing webcam:', error);
        
        // Optionally show an error message to the user
        addMessage('Error accessing webcam. Please check permissions and try again.', false);
    }
}

/**
 * Capture a frame from the webcam feed and convert it to base64
 * This function grabs the current frame from the video element,
 * draws it to a hidden canvas, and converts it to a base64 string
 */
function captureWebcamFrame() {
    // Check if webcam feed is active
    if (!webcamFeed.srcObject || !captureCanvas) {
        console.error('Webcam feed is not active or canvas element is missing');
        return;
    }
    
    // Get the dimensions of the video feed
    const videoWidth = webcamFeed.videoWidth;
    const videoHeight = webcamFeed.videoHeight;
    
    // Set the canvas dimensions to match the video
    captureCanvas.width = videoWidth;
    captureCanvas.height = videoHeight;
    
    // Get the 2D drawing context from the canvas
    const context = captureCanvas.getContext('2d');
    
    // Draw the current frame from the video onto the canvas
    context.drawImage(webcamFeed, 0, 0, videoWidth, videoHeight);
    
    // Convert the canvas content to a base64 encoded JPEG image
    const imageDataBase64 = captureCanvas.toDataURL('image/jpeg');
    
    // Log the first part of the base64 string to confirm it worked
    console.log('Captured frame (Base64):', imageDataBase64.substring(0, 100) + '...');
    
    // TODO: Send this imageDataBase64 to the backend or process it further
    // TODO: Add function to submit image for AI analysis with selected model
    
    return imageDataBase64;
}

// Add socket event handlers for streaming responses
// Handler for receiving a chunk of the streaming response
socket.on('stream_response_chunk', (data) => {
    // Add the new chunk to the accumulated response text
    currentResponseText += data.text;
    
    // Find or create AI response container if it doesn't exist
    if (!currentResponseContainer) {
        // Try to find the last AI message element
        const allMessages = chatMessages.querySelectorAll('.ai-message');
        if (allMessages.length > 0) {
            currentResponseContainer = allMessages[allMessages.length - 1];
        } else {
            // If no AI message found, create a new one
            console.log('Creating new AI message container since none was found');
            currentResponseContainer = createAIResponseContainer();
        }
    }
    
    // Update the text content of the container
    if (currentResponseContainer) {
        currentResponseContainer.textContent = currentResponseText;
        
        // Scroll to the bottom of the chat to show the new content
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
        console.error('Cannot find or create AI message container to update');
    }
});

// Handler for the end of a streaming response
socket.on('stream_response_end', () => {
    // Save the completed response to chat history
    if (currentResponseText.trim() !== '') {
        // We don't add a new message element, just save the streamed one to history
        try {
            const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
            const history = savedHistory ? JSON.parse(savedHistory) : [];
            history.push({ text: currentResponseText, isUser: false });
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
        } catch (error) {
            console.error('Error saving AI response to chat history:', error);
        }
    }
    
    // Reset the current response text and container reference for the next message
    currentResponseText = '';
    currentResponseContainer = null;
});

// Add event listener for the record button
recordButton.addEventListener('click', () => {
    if (!isRecording) {
        startRecording();
        recordButton.textContent = '🔴 Stop';
        isRecording = true;
    } else {
        stopRecording();
        recordButton.textContent = '🎤 Record';
        isRecording = false;
    }
});

// Add event listener for the send button
sendButton.addEventListener('click', () => {
    sendMessage();
});

// Add event listener for Enter key in the message input
messageInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
        sendMessage();
    }
});

// Add event listener for the capture button
captureButton.addEventListener('click', () => {
    console.log('Capturing frame from webcam...');

    // Capture the current frame from the webcam
    const imageDataBase64 = captureWebcamFrame();

    // Get the current text from the message input field
    const messageText = messageInput.value.trim();

    // Get the currently selected model name
    const selectedModel = modelSelector.value;

    // Display the text message (if any) in the chat
    if (messageText) {
        addMessage(messageText, true);
    }

    // Display the captured image in the chat
    const imageMessageElement = document.createElement('div');
    imageMessageElement.classList.add('message', 'user-message');

    const imageElement = document.createElement('img');
    imageElement.src = imageDataBase64;
    imageElement.classList.add('message-image');
    imageElement.style.maxWidth = '200px'; // Set a max width for the image

    imageMessageElement.appendChild(imageElement);
    chatMessages.appendChild(imageMessageElement);

    // Scroll to the bottom of the chat to show the new content
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Emit the data to the server
    socket.emit('send_message', {
        message: messageText,
        image_base64: imageDataBase64,
        model_name: selectedModel,
        history: [] // Empty for now
    });

    // Clear the text input field
    messageInput.value = '';

    // Prepare for the AI's response
    createAIResponseContainer();

    // Reset the current response text
    currentResponseText = '';
});

// Socket connection events
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    // Display an error message to the user
    addMessage('Error connecting to server. Please refresh the page.', false);
});

// Initialize the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Populate the model selector dropdown
    populateModelSelector();
    
    // Load chat history from localStorage
    loadChatHistory();
    
    // Initialize webcam
    setupWebcam();
});
