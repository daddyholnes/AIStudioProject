import os
from flask import Flask, render_template
from flask_socketio import SocketIO, emit
import google.auth
import vertexai
from vertexai.generative_models import GenerativeModel

# Define constants for Google Vertex AI
PROJECT_ID = "camera-calibration-beta"
LOCATION = "us-central1"
AVAILABLE_MODELS = ["gemini-1.5-flash-001", "gemini-1.5-pro-preview-0514"]

# Initialize Flask application
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'  # Replace with a proper secret key in production

# Initialize SocketIO with CORS enabled for all origins for development
socketio = SocketIO(app, cors_allowed_origins='*')

# Initialize Vertex AI
try:
    vertexai.init(project=PROJECT_ID, location=LOCATION)
    print(f"Vertex AI initialized with project: {PROJECT_ID}, location: {LOCATION}")
except Exception as e:
    print(f"Error initializing Vertex AI: {e}")
    print("Make sure GOOGLE_APPLICATION_CREDENTIALS is properly set in your environment")

# Flask routes
@app.route('/')
def index():
    """Serve the main application page"""
    return render_template('index.html')

# SocketIO event handlers
@socketio.on('connect')
def handle_connect():
    """Handle client connection event"""
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection event"""
    print('Client disconnected')

@socketio.on('send_message')
def handle_message(data):
    """
    Handle incoming messages from client and process them with Vertex AI Gemini
    
    Expected data format:
    {
        'message': 'User message text',
        'model_name': 'model-name-from-available-models',
        'history': [] # Optional chat history
    }
    """
    try:
        # Extract data from client request
        message = data.get('message', '')
        model_name = data.get('model_name', '')
        # history = data.get('history', [])  # For future use with chat history
        
        print(f"Received message: {message}")
        print(f"Selected model: {model_name}")
        
        # Validate the model name
        if model_name not in AVAILABLE_MODELS:
            print(f"Invalid model selected: {model_name}")
            emit('error', {'message': f'Invalid model selected. Available models: {", ".join(AVAILABLE_MODELS)}'})
            return
        
        # Instantiate the selected Gemini model
        model = GenerativeModel(model_name)
        
        # Generate content with streaming enabled
        print(f"Generating response using {model_name}...")
        response = model.generate_content(message, stream=True)
        
        # Stream the response chunks back to the client
        for chunk in response:
            if hasattr(chunk, 'text') and chunk.text:
                emit('stream_response_chunk', {'text': chunk.text})
        
        # Signal that streaming is complete
        emit('stream_response_end', {})
        print("Response streaming completed")
        
    except Exception as e:
        error_message = f"Error processing message with Vertex AI: {str(e)}"
        print(error_message)
        emit('error', {'message': error_message})

# Main execution block
if __name__ == '__main__':
    # Run the SocketIO server
    # host='0.0.0.0' makes it accessible on your network
    # Use host='127.0.0.1' for strictly local access
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)