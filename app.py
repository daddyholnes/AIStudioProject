import os
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import google.auth
import vertexai
from vertexai.generative_models import GenerativeModel
import base64
from google.cloud import texttospeech
import google.cloud.speech

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

# Initialize Google Cloud Text-to-Speech Client
try:
    tts_client = texttospeech.TextToSpeechClient()
    print("Google Cloud Text-to-Speech client initialized successfully")
except Exception as e:
    print(f"Error initializing Text-to-Speech client: {e}")
    print("Make sure GOOGLE_APPLICATION_CREDENTIALS is properly set in your environment")
    tts_client = None

# Initialize Google Cloud Speech-to-Text Client
try:
    stt_client = google.cloud.speech.SpeechClient()
    print("Google Cloud Speech-to-Text client initialized successfully")
except Exception as e:
    print(f"Error initializing Speech-to-Text client: {e}")
    print("Make sure GOOGLE_APPLICATION_CREDENTIALS is properly set in your environment")
    stt_client = None

# Flask routes
@app.route('/')
def index():
    """Serve the main application page"""
    return render_template('index.html')

@app.route('/tts', methods=['POST'])
def text_to_speech():
    """
    Convert text to speech using Google Cloud Text-to-Speech API
    
    Expected request format:
    {
        'text': 'Text to be converted to speech'
    }
    
    Returns:
    {
        'audio_base64': 'base64 encoded audio data'
    }
    or
    {
        'error': 'Error message'
    }
    """
    if tts_client is None:
        return jsonify({'error': 'Text-to-Speech service not available'}), 503
    
    try:
        # Get JSON data from request
        data = request.get_json()
        
        # Extract text to synthesize
        if not data or 'text' not in data or not data['text'].strip():
            return jsonify({'error': 'No text provided'}), 400
        
        text_to_synthesize = data['text']
        
        # Set up the TTS request
        synthesis_input = texttospeech.SynthesisInput(text=text_to_synthesize)
        
        # Configure voice parameters
        voice = texttospeech.VoiceSelectionParams(
            language_code="en-US",
            name="en-US-Studio-O"
        )
        
        # Configure audio format
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3
        )
        
        # Generate speech
        response = tts_client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config
        )
        
        # Convert audio content to base64
        audio_base64 = base64.b64encode(response.audio_content).decode('utf-8')
        
        # Return the base64 encoded audio
        return jsonify({'audio_base64': audio_base64})
        
    except Exception as e:
        error_message = f"Error processing Text-to-Speech request: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500

@app.route('/stt', methods=['POST'])
def speech_to_text():
    """
    Convert speech to text using Google Cloud Speech-to-Text API

    Expected request format:
    {
        'audio_base64': 'base64 encoded audio data',
        'mime_type': 'audio/webm' or 'audio/ogg' etc.
    }

    Returns:
    {
        'transcript': 'Recognized text from audio'
    }
    or
    {
        'error': 'Error message'
    }
    """
    if stt_client is None:
        return jsonify({'error': 'Speech-to-Text service not available'}), 503

    try:
        # Get JSON data from request
        data = request.get_json()

        # Extract audio_base64 and mime_type
        audio_base64 = data.get('audio_base64')
        mime_type = data.get('mime_type')

        if not audio_base64 or not mime_type:
            return jsonify({'error': 'Missing audio_base64 or mime_type'}), 400

        # Decode the base64 audio data
        audio_bytes = base64.b64decode(audio_base64)

        # Set up the RecognitionAudio object
        audio = google.cloud.speech.RecognitionAudio(content=audio_bytes)

        # Map mime_type to encoding
        if mime_type == 'audio/webm':
            encoding = google.cloud.speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
        elif mime_type == 'audio/ogg':
            encoding = google.cloud.speech.RecognitionConfig.AudioEncoding.OGG_OPUS
        else:
            return jsonify({'error': f'Unsupported mime_type: {mime_type}'}), 400

        # Set up the RecognitionConfig object
        config = google.cloud.speech.RecognitionConfig(
            encoding=encoding,
            sample_rate_hertz=48000,
            language_code="en-US",
            enable_automatic_punctuation=True
        )

        # Call the STT client to recognize speech
        response = stt_client.recognize(config=config, audio=audio)

        # Extract the transcript
        if not response.results:
            return jsonify({'error': 'No speech recognized'}), 400

        transcript = " ".join(result.alternatives[0].transcript for result in response.results)

        # Return the transcript
        return jsonify({'transcript': transcript})

    except Exception as e:
        error_message = f"Error processing Speech-to-Text request: {str(e)}"
        print(error_message)
        return jsonify({'error': error_message}), 500

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