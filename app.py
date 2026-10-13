# app.py
from flask import Flask, render_template, request, jsonify, send_from_directory, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room
import os
import re
import uuid
import shutil
import subprocess
import threading
from datetime import datetime

import numpy as np
import librosa
import soundfile as sf
import noisereduce as nr
import torch
from TTS.api import TTS
from werkzeug.utils import secure_filename

from config import Database

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB
app.config['ALLOWED_EXTENSIONS'] = {'wav', 'flac', 'ogg', 'webm'}
app.secret_key = 'your_secret_key'  # Change to a secure secret key

db = Database()
socketio = SocketIO(app, cors_allowed_origins="*")

active_users = {}
user_rooms = {}
user_uploaded_files = {}

# ---------------------------------------------------------------- TTS setup
device = "cuda" if torch.cuda.is_available() else "cpu"
model_name = "tts_models/multilingual/multi-dataset/xtts_v2"
tts = None
tts_lock = threading.Lock()
latent_cache = {}


def init_tts():
    global tts
    try:
        tts = TTS(model_name).to(device)
        print(f"TTS model loaded on {device}")
    except Exception as e:
        print(f"TTS initialization error: {e}")


def get_latents(speaker_wav):
    """Compute the voice fingerprint once per sample file and reuse it."""
    key = (speaker_wav, os.path.getmtime(speaker_wav))
    if key not in latent_cache:
        latent_cache[key] = tts.synthesizer.tts_model.get_conditioning_latents(
            audio_path=[speaker_wav],
            gpt_cond_len=30,
            gpt_cond_chunk_len=6,
            max_ref_length=60,
        )
    return latent_cache[key]


def detect_language(text):
    return "hi" if re.search(r'[\u0900-\u097F]', text) else "en"


def synthesize(text, speaker_wav, output_path):
    """Generate cloned speech straight to output_path (no post-processing)."""
    with tts_lock, torch.inference_mode():
        gpt_cond_latent, speaker_embedding = get_latents(speaker_wav)
        out = tts.synthesizer.tts_model.inference(
            text=text,
            language=detect_language(text),
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
            temperature=0.65,
            top_k=50,
            top_p=0.85,
            repetition_penalty=5.0,
            enable_text_splitting=True,
        )
    sf.write(output_path, out["wav"], 24000)


os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
init_tts()


# ---------------------------------------------------------------- DB setup
def init_database():
    """Create tables if they don't exist (call manually when needed)."""
    statements = [
        """CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role ENUM('user', 'admin') DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS user_voice (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            emotion VARCHAR(50) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            quality VARCHAR(50) NOT NULL,
            summary TEXT,
            size INT NOT NULL,
            duration DECIMAL(10,2) NOT NULL,
            sample_rate INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS chat_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id INT NOT NULL,
            receiver_id INT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_read BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS voice_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id INT NOT NULL,
            receiver_id INT NOT NULL,
            audio_url VARCHAR(255) NOT NULL,
            duration INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_read BOOLEAN DEFAULT FALSE,
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS voice_clones (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            name VARCHAR(100) NOT NULL,
            model_path VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS friends (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            friend_id INT NOT NULL,
            status ENUM('pending', 'accepted') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
        )""",
        """CREATE TABLE IF NOT EXISTS shared_audios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id INT NOT NULL,
            receiver_id INT NOT NULL,
            audio_url VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
        )""",
    ]
    try:
        for sql in statements:
            db.execute(sql)
        print("Database tables initialized successfully")
    except Exception as e:
        print(f"Database initialization error: {e}")


# ---------------------------------------------------------------- audio helpers
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']


def convert_to_wav(input_path, output_path):
    """Convert supported audio formats to WAV (FFmpeg for WebM)."""
    try:
        if os.path.splitext(input_path)[1].lower() == '.webm':
            if not shutil.which('ffmpeg'):
                raise Exception("FFmpeg not found. Install FFmpeg for WebM support.")
            subprocess.run(
                ['ffmpeg', '-i', input_path, '-vn', '-acodec', 'pcm_s16le',
                 '-ar', '22050', '-ac', '1', output_path, '-y'],
                check=True, capture_output=True, text=True
            )
        else:
            y, sr = librosa.load(input_path, sr=None)
            sf.write(output_path, y, sr)
        return True
    except Exception as e:
        print(f"Conversion error: {e}")
        return False


def enhance_audio(input_path, output_path):
    """Noise reduction + normalization."""
    try:
        data, rate = librosa.load(input_path, sr=None)
        reduced = nr.reduce_noise(y=data, sr=rate, prop_decrease=0.8)
        sf.write(output_path, librosa.util.normalize(reduced), rate)
        return True
    except Exception as e:
        print(f"Enhancement error: {e}")
        return False


def get_audio_info(file_path):
    try:
        y, sr = librosa.load(file_path, sr=None)
        return {
            'duration': round(librosa.get_duration(y=y, sr=sr), 2),
            'sample_rate': sr,
            'file_size': round(os.path.getsize(file_path) / 1024, 2),  # KB
            'channels': 1 if len(y.shape) == 1 else y.shape[0]
        }
    except Exception as e:
        print(f"Info extraction error: {e}")
        return None


def assess_audio_quality(file_path):
    try:
        y, sr = librosa.load(file_path, sr=None)

        rms_energy = np.sqrt(np.mean(y ** 2))
        zero_crossing_rate = np.mean(librosa.feature.zero_crossing_rate(y))
        signal_power = np.mean(y ** 2)
        noise_floor = np.percentile(np.abs(y), 10)
        snr_estimate = 20 * np.log10(signal_power / (noise_floor ** 2 + 1e-10))

        score = 0
        score += 30 if sr >= 44100 else 20 if sr >= 22050 else 10
        score += 25 if 0.01 <= rms_energy <= 0.5 else 15 if 0.005 <= rms_energy <= 0.8 else 5
        score += 25 if snr_estimate > 20 else 15 if snr_estimate > 10 else 5
        score += 20 if 0.01 <= zero_crossing_rate <= 0.1 else 10

        if score >= 80:
            quality, needs_enhancement = "High", False
        elif score >= 60:
            quality, needs_enhancement = "Medium", False
        else:
            quality, needs_enhancement = "Low", True

        return {
            'quality': quality,
            'quality_score': score,
            'needs_enhancement': needs_enhancement,
            'rms_energy': rms_energy,
            'snr_estimate': snr_estimate,
            'zero_crossing_rate': zero_crossing_rate
        }
    except Exception as e:
        print(f"Quality assessment error: {e}")
        return {
            'quality': "Unknown", 'quality_score': 0, 'needs_enhancement': True,
            'rms_energy': 0, 'snr_estimate': 0, 'zero_crossing_rate': 0
        }


def generate_audio_summary(file_info, quality_info, emotion):
    duration = file_info['duration']
    sample_rate = file_info['sample_rate']
    quality = quality_info['quality']

    summary = f"Audio file with {duration:.1f} seconds duration, recorded at {sample_rate} Hz sample rate. "
    if quality == "High":
        summary += "High quality audio with excellent clarity and minimal noise. "
    elif quality == "Medium":
        summary += "Good quality audio suitable for most applications. "
    else:
        summary += "Audio quality could benefit from enhancement to improve clarity. "
    summary += f"Emotion classification: {emotion.title()}. "
    if sample_rate >= 44100:
        summary += "High-resolution audio suitable for professional voice applications."
    else:
        summary += "Standard quality audio suitable for general voice applications."
    return summary


def build_file_data(filename, original_name, info, quality_info, emotion, summary):
    return {
        'filename': filename,
        'original_name': original_name,
        'duration': info['duration'],
        'file_size': info['file_size'],
        'sample_rate': info['sample_rate'],
        'quality': quality_info['quality'],
        'quality_score': quality_info['quality_score'],
        'needs_enhancement': quality_info['needs_enhancement'],
        'enhanced': False,
        'emotion': emotion,
        'summary': summary,
        'submitted': False,
        'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


# ---------------------------------------------------------------- auth routes
@app.route('/')
def landing():
    return render_template('landing.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        sql = f"SELECT * FROM users WHERE (username='{username}' OR email='{username}') AND password='{password}'"
        result = db.fetchone(sql)
        if result:
            session['user'] = result['id']
            if result['role'] == 'admin':
                return render_template('admin.html')
            if result['role'] == 'user':
                return redirect(url_for('main_app'))
        else:
            return render_template('login.html', error="Invalid Credentials")
    return render_template('login.html')


@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')

        if not username or not email or not password:
            return render_template('signup.html', error="All fields are required")
        if len(username) < 3:
            return render_template('signup.html', error="Username must be at least 3 characters")
        if len(password) < 6:
            return render_template('signup.html', error="Password must be at least 6 characters")
        if password != confirm_password:
            return render_template('signup.html', error="Passwords do not match")

        try:
            if db.fetchone("SELECT * FROM users WHERE email=%s", (email,)):
                return render_template('signup.html', error="Email already registered")
            if db.fetchone("SELECT * FROM users WHERE username=%s", (username,)):
                return render_template('signup.html', error="Username already taken")

            db.execute(
                "INSERT INTO users (username, email, password, role) VALUES (%s, %s, %s, 'user')",
                (username, email, password)
            )
            return render_template('signup.html', success="Account created successfully! Please login.")
        except Exception as e:
            print(f"Signup error: {e}")
            return render_template('signup.html', error="An error occurred. Please try again.")

    return render_template('signup.html')


@app.route('/app')
def main_app():
    return render_template('index.html')


@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('landing'))


# ---------------------------------------------------------------- upload / record / enhance
@app.route('/upload', methods=['POST'])
def upload_file():
    if 'files[]' not in request.files:
        return jsonify({'error': 'No files provided'}), 400
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401

    user_id = session['user']
    files = request.files.getlist('files[]')
    emotion = request.form.get('emotion', 'neutral')
    results, errors = [], []

    for file in files:
        if file.filename == '':
            continue
        if not allowed_file(file.filename):
            errors.append(file.filename)
            continue

        original_filename = secure_filename(file.filename)
        file_id = str(uuid.uuid4())
        temp_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{file_id}_temp_{original_filename}")
        wav_filename = f"{file_id}_{original_filename.rsplit('.', 1)[0]}.wav"
        wav_path = os.path.join(app.config['UPLOAD_FOLDER'], wav_filename)

        file.save(temp_path)

        if convert_to_wav(temp_path, wav_path):
            os.remove(temp_path)
            info = get_audio_info(wav_path)
            if info:
                quality_info = assess_audio_quality(wav_path)
                summary = generate_audio_summary(info, quality_info, emotion)
                file_data = build_file_data(wav_filename, original_filename, info, quality_info, emotion, summary)
                results.append(file_data)
                user_uploaded_files.setdefault(user_id, []).append(file_data)
        elif os.path.exists(temp_path):
            os.remove(temp_path)

    return jsonify({'files': results, 'errors': errors})


@app.route('/record-voice', methods=['POST'])
def record_voice():
    """Handle live voice recording for cloning"""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio provided'}), 400
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401

    user_id = session['user']
    audio_file = request.files['audio']
    if audio_file.filename == '':
        return jsonify({'error': 'Empty audio file'}), 400

    file_id = str(uuid.uuid4())
    temp_webm = os.path.join(app.config['UPLOAD_FOLDER'], f"live_temp_{file_id}.webm")
    temp_wav = os.path.join(app.config['UPLOAD_FOLDER'], f"live_temp_{file_id}.wav")

    audio_file.save(temp_webm)

    if not convert_to_wav(temp_webm, temp_wav):
        for p in (temp_webm, temp_wav):
            if os.path.exists(p):
                os.remove(p)
        return jsonify({'error': 'Audio conversion failed. Ensure FFmpeg is installed for WebM support.'}), 500

    os.remove(temp_webm)

    final_filename = f"live_{file_id}.wav"
    final_path = os.path.join(app.config['UPLOAD_FOLDER'], final_filename)
    os.rename(temp_wav, final_path)

    info = get_audio_info(final_path)
    if not info:
        if os.path.exists(final_path):
            os.remove(final_path)
        return jsonify({'error': 'Failed to process audio info'}), 500

    quality_info = assess_audio_quality(final_path)
    emotion = 'neutral'
    summary = generate_audio_summary(info, quality_info, emotion)
    file_data = build_file_data(final_filename, 'Live Recording', info, quality_info, emotion, summary)

    user_uploaded_files.setdefault(user_id, []).append(file_data)
    return jsonify({'success': True, 'file': file_data})


@app.route('/enhance', methods=['POST'])
def enhance_file():
    data = request.get_json()
    filename = data.get('filename')

    if not filename:
        return jsonify({'error': 'No filename provided'}), 400
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401

    filename = secure_filename(filename)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404

    temp_enhanced = os.path.join(app.config['UPLOAD_FOLDER'], f"temp_enhanced_{filename}")

    if enhance_audio(file_path, temp_enhanced):
        os.remove(file_path)
        os.rename(temp_enhanced, file_path)

        info = get_audio_info(file_path)
        quality_info = assess_audio_quality(file_path)

        user_id = session.get('user')
        for uploaded_file in user_uploaded_files.get(user_id, []):
            if uploaded_file['filename'] == filename:
                uploaded_file['enhanced'] = True
                uploaded_file['quality'] = 'Enhanced'
                uploaded_file['needs_enhancement'] = False
                break

        return jsonify({
            'success': True,
            'message': 'Audio enhanced successfully',
            'filename': filename,
            'duration': info['duration'],
            'file_size': info['file_size'],
            'quality': 'Enhanced',
            'quality_score': quality_info['quality_score'],
            'needs_enhancement': False
        })

    if os.path.exists(temp_enhanced):
        os.remove(temp_enhanced)
    return jsonify({'error': 'Enhancement failed'}), 500


@app.route('/submit-audio', methods=['POST'])
def submit_audio():
    """Submit audio file to database"""
    data = request.get_json()
    filename = data.get('filename')
    emotion = data.get('emotion', 'neutral')

    if not filename:
        return jsonify({'error': 'No filename provided'}), 400
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401

    user_id = session['user']
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(file_path):
        return jsonify({'error': 'File not found'}), 404

    try:
        info = get_audio_info(file_path)
        quality_info = assess_audio_quality(file_path)
        summary = generate_audio_summary(info, quality_info, emotion)
        final_quality = quality_info['quality']

        db.execute(
            """INSERT INTO user_voice (user_id, emotion, filename, quality, summary, size, duration, sample_rate)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (user_id, emotion, filename, final_quality, summary,
             int(info['file_size'] * 1024), info['duration'], info['sample_rate'])
        )

        if user_id in user_uploaded_files:
            user_uploaded_files[user_id] = [
                f for f in user_uploaded_files[user_id] if f['filename'] != filename
            ]

        return jsonify({
            'success': True,
            'message': 'Audio submitted successfully',
            'filename': filename,
            'quality': final_quality,
            'summary': summary
        })
    except Exception as e:
        print(f"Database submission error: {e}")
        return jsonify({'error': 'Failed to submit audio to database'}), 500


# ---------------------------------------------------------------- audio listing
@app.route('/get-audio-files')
def get_audio_files():
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401

    user_id = session['user']
    try:
        db_files = db.fetchall("SELECT * FROM user_voice WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
        files = []
        for f in db_files:
            if os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], f['filename'])):
                files.append({
                    'id': f['id'],
                    'filename': f['filename'],
                    'duration': float(f['duration']),
                    'file_size': round(f['size'] / 1024, 2),
                    'sample_rate': f['sample_rate'],
                    'quality': f['quality'],
                    'emotion': f['emotion'],
                    'summary': f['summary'],
                    'created_at': f['created_at'].strftime('%Y-%m-%d %H:%M:%S'),
                    'submitted': True
                })
        return jsonify({'files': files})
    except Exception as e:
        print(f"Error fetching audio files: {e}")
        return jsonify({'error': 'Failed to fetch audio files'}), 500


@app.route('/get-all-audio-files')
def get_all_audio_files():
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401

    user_id = session['user']
    try:
        db_files = db.fetchall("SELECT * FROM user_voice WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
        submitted_filenames = set()
        files = []

        for f in db_files:
            if os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], f['filename'])):
                submitted_filenames.add(f['filename'])
                files.append({
                    'id': f['id'],
                    'filename': f['filename'],
                    'duration': f['duration'],
                    'file_size': f['size'],
                    'sample_rate': f['sample_rate'],
                    'quality': f['quality'],
                    'emotion': f['emotion'],
                    'summary': f['summary'],
                    'created_at': f['created_at'].strftime('%Y-%m-%d %H:%M:%S'),
                    'submitted': True
                })

        for uf in user_uploaded_files.get(user_id, []):
            path = os.path.join(app.config['UPLOAD_FOLDER'], uf['filename'])
            if os.path.exists(path) and uf['filename'] not in submitted_filenames:
                files.append(uf)

        files.sort(key=lambda x: x['created_at'], reverse=True)
        return jsonify({'files': files})
    except Exception as e:
        print(f"Error fetching all audio files: {e}")
        return jsonify({'error': 'Failed to fetch audio files'}), 500


@app.route('/uploads/<filename>')
def serve_audio(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/voice_messages/<filename>')
def serve_voice_message(filename):
    return send_from_directory(os.path.join(app.config['UPLOAD_FOLDER'], 'voice_messages'), filename)


@app.route('/get-user-voices')
def get_user_voices():
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401

    user_id = session['user']
    try:
        db_files = db.fetchall("SELECT * FROM user_voice WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
        voices = []
        for f in db_files:
            if os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], f['filename'])):
                voices.append({
                    'id': f['id'],
                    'filename': f['filename'],
                    'emotion': f['emotion'],
                    'quality': f['quality'],
                    'created_at': f['created_at'].strftime('%Y-%m-%d %H:%M:%S')
                })
        return jsonify({'voices': voices})
    except Exception as e:
        print(f"Error fetching user voices: {e}")
        return jsonify({'error': 'Failed to fetch user voices'}), 500


# ---------------------------------------------------------------- friends
@app.route('/search-users', methods=['POST'])
def search_users():
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    query = request.get_json().get('query', '')
    current_user_id = session['user']

    if not query:
        return jsonify({'users': []})

    try:
        users = db.fetchall(
            """SELECT id, username FROM users
               WHERE username LIKE %s AND id != %s AND role != 'admin'
               LIMIT 50""",
            (f"%{query}%", current_user_id)
        )

        results = []
        for user in users:
            friendship = db.fetchone(
                """SELECT status FROM friends
                   WHERE (user_id = %s AND friend_id = %s)
                   OR (user_id = %s AND friend_id = %s)""",
                (current_user_id, user['id'], user['id'], current_user_id)
            )
            results.append({
                'id': user['id'],
                'username': user['username'],
                'status': friendship['status'] if friendship else 'none'
            })
        return jsonify({'users': results})
    except Exception as e:
        print(f"Search error: {e}")
        return jsonify({'error': 'Search failed'}), 500


@app.route('/add-friend', methods=['POST'])
def add_friend():
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    friend_id = request.get_json().get('friend_id')
    user_id = session['user']

    try:
        existing = db.fetchone(
            """SELECT * FROM friends
               WHERE (user_id = %s AND friend_id = %s)
               OR (user_id = %s AND friend_id = %s)""",
            (user_id, friend_id, friend_id, user_id)
        )
        if existing:
            return jsonify({'error': 'Already friends or pending'}), 400

        db.execute("INSERT INTO friends (user_id, friend_id, status) VALUES (%s, %s, 'accepted')",
                   (user_id, friend_id))
        return jsonify({'success': True})
    except Exception as e:
        print(f"Add friend error: {e}")
        return jsonify({'error': 'Failed to add friend'}), 500


@app.route('/get-friends')
def get_friends():
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = session['user']
    try:
        friends = db.fetchall(
            """SELECT u.id, u.username
               FROM users u
               JOIN friends f ON (u.id = f.friend_id OR u.id = f.user_id)
               WHERE (f.user_id = %s OR f.friend_id = %s)
               AND f.status = 'accepted'
               AND u.id != %s""",
            (user_id, user_id, user_id)
        )
        return jsonify({'friends': friends})
    except Exception as e:
        print(f"Get friends error: {e}")
        return jsonify({'error': 'Failed to get friends'}), 500


@app.route('/get-active-users')
def get_active_users():
    if 'user' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        users = db.fetchall(
            "SELECT id, username, email FROM users WHERE id != %s ORDER BY username",
            (session['user'],)
        )
        return jsonify({'users': users})
    except Exception as e:
        print(f"Error fetching active users: {e}")
        return jsonify({'error': 'Failed to fetch users'}), 500


# ---------------------------------------------------------------- chat
@app.route('/chat')
def chat():
    if 'user' not in session:
        return redirect(url_for('login'))
    return render_template('chat.html')


@app.route('/get-chat-history', methods=['POST'])
def get_chat_history():
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    friend_id = request.get_json().get('friend_id')
    user_id = session['user']

    try:
        text_msgs = db.fetchall(
            """SELECT id, sender_id, message, created_at, 'text' as type, NULL as audio_url
               FROM chat_messages
               WHERE (sender_id = %s AND receiver_id = %s)
               OR (sender_id = %s AND receiver_id = %s)""",
            (user_id, friend_id, friend_id, user_id)
        )
        voice_msgs = db.fetchall(
            """SELECT id, sender_id, 'Voice Message' as message, created_at, 'voice' as type, audio_url
               FROM voice_messages
               WHERE (sender_id = %s AND receiver_id = %s)
               OR (sender_id = %s AND receiver_id = %s)""",
            (user_id, friend_id, friend_id, user_id)
        )

        all_msgs = list(text_msgs) + list(voice_msgs)
        all_msgs.sort(key=lambda x: x['created_at'])

        for msg in all_msgs:
            if msg.get('audio_url') and not msg['audio_url'].startswith('/'):
                msg['audio_url'] = f"/uploads/{msg['audio_url']}"
            if not isinstance(msg['created_at'], str):
                msg['created_at'] = msg['created_at'].strftime('%Y-%m-%d %H:%M:%S')

        return jsonify({'messages': all_msgs})
    except Exception as e:
        print(f"Chat history error: {e}")
        return jsonify({'error': 'Failed to get history'}), 500


@app.route('/send-voice-chat', methods=['POST'])
def send_voice_chat():
    """Generate voice message and send to friend"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    text = data.get('text')
    friend_id = data.get('friend_id')
    voice_filename = data.get('voice_filename')
    user_id = session['user']

    if not text or not friend_id:
        return jsonify({'error': 'Missing data'}), 400

    try:
        if tts is None:
            return jsonify({'error': 'TTS not initialized'}), 500

        ref_voice_path = os.path.join(app.config['UPLOAD_FOLDER'], voice_filename or '')
        if not voice_filename or not os.path.exists(ref_voice_path):
            return jsonify({'error': 'Voice sample not found'}), 404

        output_filename = f"chat_voice_{uuid.uuid4()}.wav"
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)

        synthesize(text, ref_voice_path, output_path)

        db.execute(
            "INSERT INTO voice_messages (sender_id, receiver_id, audio_url, duration) VALUES (%s, %s, %s, 0)",
            (user_id, friend_id, output_filename)
        )

        u1, u2 = sorted([int(user_id), int(friend_id)])
        socketio.emit('receive_message', {
            'sender_id': user_id,
            'message': text,
            'timestamp': datetime.now().isoformat(),
            'type': 'voice',
            'audio_url': f'/uploads/{output_filename}'
        }, to=f"chat_{u1}_{u2}")

        return jsonify({
            'success': True,
            'audio_url': f'/uploads/{output_filename}',
            'filename': output_filename
        })
    except Exception as e:
        print(f"Voice chat generation error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/chatbot', methods=['POST'])
def chatbot():
    """Generate cloned voice audio from text"""
    data = request.get_json()
    text = data.get('text', '')
    voice = data.get('voice', '')

    if not text:
        return jsonify({'error': 'No text provided'}), 400
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401
    if not voice:
        return jsonify({'error': 'No voice selected'}), 400

    speaker_wav = os.path.join(app.config['UPLOAD_FOLDER'], voice)
    if not os.path.exists(speaker_wav):
        return jsonify({'error': 'Selected voice file not found'}), 404

    output_path = None
    try:
        if tts is None:
            return jsonify({'error': 'TTS model not initialized'}), 500

        output_filename = f"chat_{uuid.uuid4()}.wav"
        output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)

        synthesize(text, speaker_wav, output_path)

        return jsonify({
            'success': True,
            'text': text,
            'voice': voice,
            'audio_url': f'/uploads/{output_filename}',
            'message': 'Voice cloned audio generated successfully'
        })
    except Exception as e:
        print(f"TTS generation error: {e}")
        if output_path and os.path.exists(output_path):
            os.remove(output_path)
        return jsonify({'error': 'Failed to generate audio'}), 500


# ---------------------------------------------------------------- sharing
@app.route('/share-audio', methods=['POST'])
def share_audio():
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    audio_url = data.get('audio_url')
    recipient_ids = data.get('recipient_ids')

    if not audio_url or not recipient_ids:
        return jsonify({'error': 'Missing data'}), 400
    if not isinstance(recipient_ids, list):
        recipient_ids = [recipient_ids]

    sender_id = session['user']
    try:
        filename = os.path.basename(audio_url)
        for rid in recipient_ids:
            db.execute("INSERT INTO shared_audios (sender_id, receiver_id, audio_url) VALUES (%s, %s, %s)",
                       (sender_id, rid, filename))
        return jsonify({'success': True, 'message': 'Audio shared successfully'})
    except Exception as e:
        print(f"Share audio error: {e}")
        return jsonify({'error': 'Failed to share'}), 500


@app.route('/get-shared-history')
def get_shared_history():
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    try:
        shared_items = db.fetchall(
            """SELECT s.id, s.sender_id, u.username as sender_name, s.audio_url, s.created_at
               FROM shared_audios s
               JOIN users u ON s.sender_id = u.id
               WHERE s.receiver_id = %s
               ORDER BY s.created_at DESC""",
            (session['user'],)
        )

        for item in shared_items:
            if item.get('audio_url') and not item['audio_url'].startswith('/'):
                item['audio_url'] = f"/uploads/{item['audio_url']}"
            if not isinstance(item['created_at'], str):
                item['created_at'] = item['created_at'].strftime('%Y-%m-%d %H:%M')

        return jsonify({'shared_items': shared_items})
    except Exception as e:
        print(f"Get shared history error: {e}")
        return jsonify({'error': 'Failed to fetch history'}), 500


# ---------------------------------------------------------------- admin
@app.route('/admin')
def admin_panel():
    if 'user' not in session:
        return redirect(url_for('login'))

    user_role = db.fetchone("SELECT role FROM users WHERE id=%s", (session['user'],))
    if not user_role or user_role['role'] != 'admin':
        return "Access Denied", 403
    return render_template('admin.html')


@app.route('/admin-dashboard-data')
def admin_dashboard_data():
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_role = db.fetchone("SELECT role FROM users WHERE id=%s", (session['user'],))
    if not user_role or user_role['role'] != 'admin':
        return jsonify({'error': 'Access denied'}), 403

    try:
        total_users = db.fetchone("SELECT COUNT(*) as count FROM users")['count']
        total_voices = db.fetchone("SELECT COUNT(*) as count FROM user_voice")['count']
        total_messages = (db.fetchone("SELECT COUNT(*) as count FROM chat_messages")['count']
                          + db.fetchone("SELECT COUNT(*) as count FROM voice_messages")['count'])

        users = db.fetchall(
            "SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 50"
        )
        for u in users:
            u['created_at'] = u['created_at'].strftime('%Y-%m-%d')

        return jsonify({
            'stats': {'users': total_users, 'voices': total_voices, 'messages': total_messages},
            'users': users
        })
    except Exception as e:
        print(f"Admin stats error: {e}")
        return jsonify({'error': 'Failed to fetch stats'}), 500


@app.route('/debug-user-files')
def debug_user_files():
    if 'user' not in session:
        return jsonify({'error': 'User not logged in'}), 401

    user_id = session['user']
    return jsonify({
        'user_id': user_id,
        'uploaded_files': user_uploaded_files.get(user_id, []),
        'all_uploaded_files': list(user_uploaded_files.keys())
    })


# ---------------------------------------------------------------- socket events
@socketio.on('connect')
def handle_connect():
    if 'user' in session:
        user_id = session['user']
        active_users[request.sid] = user_id
        join_room(f"user_{user_id}")
        print(f"User {user_id} connected with SID: {request.sid}")


@socketio.on('disconnect')
def handle_disconnect():
    user_id = active_users.pop(request.sid, None)
    if user_id:
        print(f"User {user_id} disconnected")


@socketio.on('join_chat')
def handle_join_chat(data):
    if 'user' not in session:
        return {'status': 'error', 'message': 'Not authenticated'}

    user_id = session['user']
    target_user_id = data.get('target_user_id')
    if not target_user_id:
        return {'status': 'error', 'message': 'Target user required'}

    u1, u2 = sorted([int(user_id), int(target_user_id)])
    room = f"chat_{u1}_{u2}"
    join_room(room)
    user_rooms[user_id] = room
    print(f"User {user_id} joined room {room}")
    return {'status': 'success', 'room': room}


@socketio.on('send_message')
def handle_send_message(data):
    if 'user' not in session:
        return {'status': 'error', 'message': 'Not authenticated'}

    user_id = session['user']
    message_text = data.get('message', '').strip()
    target_user_id = data.get('friend_id')

    if not message_text or not target_user_id:
        return {'status': 'error', 'message': 'Message and target user required'}

    try:
        db.execute("INSERT INTO chat_messages (sender_id, receiver_id, message) VALUES (%s, %s, %s)",
                   (user_id, target_user_id, message_text))

        u1, u2 = sorted([int(user_id), int(target_user_id)])
        emit('receive_message', {
            'sender_id': user_id,
            'message': message_text,
            'timestamp': datetime.now().isoformat(),
            'type': 'text'
        }, to=f"chat_{u1}_{u2}")
        return {'status': 'success'}
    except Exception as e:
        print(f"Socket message error: {e}")
        return {'status': 'error', 'message': str(e)}


@socketio.on('typing')
def handle_typing(data):
    user_id = session.get('user')
    target_user_id = data.get('target_user_id')
    if user_id and target_user_id:
        u1, u2 = sorted([int(user_id), int(target_user_id)])
        emit('typing', {'sender_id': user_id, 'is_typing': data.get('is_typing')},
             to=f"chat_{u1}_{u2}", include_self=False)


if __name__ == '__main__':
    os.makedirs(os.path.join(app.config['UPLOAD_FOLDER'], 'voice_messages'), exist_ok=True)
    socketio.run(app, debug=True, host="127.0.0.1", port=5000,
                 use_reloader=False, allow_unsafe_werkzeug=True)