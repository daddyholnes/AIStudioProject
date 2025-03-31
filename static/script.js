// Initialize Socket.IO connection
const socket = io();

// Get references to DOM elements
const chatMessages = document.getElementById('chat-messages');
const modelSelector = document.getElementById('model-selector');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

// Available models from the server
const AVAILABLE_MODELS = ["gemini-1.5-flash-001", "gemini-1.5-pro-preview-0514"];

// Populate model selector dropdown
function populateModelSelector() {
    AVAILABLE_MODELS.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelector.appendChild(option);
    });
}

// Add a message to the chat display
function addMessage(text, isUser = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(isUser ? 'user-message' : 'ai-message');
    messageElement.textContent = text;
    chatMessages.appendChild(messageElement);
    
    // Scroll to the bottom of the chat
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Create a new AI response container that can be updated with streaming content
function createAIResponseContainer() {
    const responseElement = document.createElement('div');
    responseElement.classList.add('message', 'ai-message');
    chatMessages.appendChild(responseElement);
    return responseElement;
}

// Send a message to the server
function sendMessage() {
    const message = messageInput.value.trim();
    const selectedModel = modelSelector.value;
    
    if (message === '') return;
    
    // Display user message in the chat
    addMessage(message, true);
    
    // Clear input field
    messageInput.value = '';
    
    // Create a container for the AI's response
    const aiResponseContainer = createAIResponseContainer();
    
    // Send message to server
    socket.emit('send_message', {
        message: message,
        model_name: selectedModel,
        history: [] // Empty for now, will be implemented later
    });
}

// Event listeners
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Socket.IO event handlers
let currentResponseText = '';

socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('stream_response_chunk', (data) => {
    // Find the last AI message container and update it
    const lastMessage = chatMessages.lastElementChild;
    if (lastMessage && lastMessage.classList.contains('ai-message')) {
        currentResponseText += data.text;
        lastMessage.textContent = currentResponseText;
        
        // Scroll to the bottom of the chat
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});

socket.on('stream_response_end', () => {
    console.log('Response streaming completed');
    currentResponseText = ''; // Reset for next response
});

socket.on('error', (data) => {
    console.error('Server error:', data.message);
    addMessage(`Error: ${data.message}`, false);
});

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    populateModelSelector();
});