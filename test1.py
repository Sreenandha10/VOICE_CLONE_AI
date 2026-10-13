import librosa
import torch
from zerovox.tts.synthesize import ZeroVoxTTS
import soundfile as sf  # For saving the audio file

# Parameters
model_name = "goooofy/tts_en_de_zerovox_alpha1"  # The Hugging Face model
language = "en"  # or "de" for German
voice_sample_path = "C:/Users/Admin/Desktop/voice_clone/test_audio.wav"  # Replace with the actual path to the uploaded voice sample

text_to_speak = "Hello, this is a test of voice cloning with ZeroVOX TTS."  # Replace with your text input
output_path = "generated_speech.wav"  # Output file path
sample_rate = 24000  # As per the model

# Load the model
print("Loading the model...")
modelcfg, synth = ZeroVoxTTS.load_model(
    ZeroVoxTTS.get_default_model(language),
    meldec_model="meldec-libritts-hifigan-v1",  # Choose a suitable MEL decoder; options from the demo
    infer_device="cpu",  # Use "cuda" if GPU available
    num_threads=-1,
    verbose=True
)

# Load the voice sample
print("Loading voice sample...")
voice_wav, sr = librosa.load(voice_sample_path, sr=sample_rate)
if sr != sample_rate:
    print("Resampling voice sample to match model sample rate.")

# Compute speaker embedding
print("Computing speaker embedding...")
speaker_embedding = synth.speaker_embed(voice_wav)

# Synthesize speech
print("Synthesizing speech...")
wav, _, _ = synth.tts(text_to_speak, speaker_embedding)

# Save the generated audio
sf.write(output_path, wav, sample_rate)
print(f"Generated speech saved to {output_path}")

# Optional: Play the audio (requires additional setup, e.g., with IPython.display.Audio in Jupyter)
# from IPython.display import Audio
# Audio(wav, rate=sample_rate)