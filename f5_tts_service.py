import os
import torch
import torchaudio
import soundfile as sf
import numpy as np
from pathlib import Path

# Try importing F5-TTS components
# NOTE: User must install f5-tts first: pip install git+https://github.com/SWivid/F5-TTS.git
try:
    from f5_tts.model import DiT
    from f5_tts.infer.utils_infer import (
        load_checkpoint, 
        infer_process, 
        preprocess_ref_audio_text,
    )
    from f5_tts.model.utils import get_tokenizer
except ImportError:
    print("F5-TTS library not found. Please install it using the instructions provided.")

class F5TTSService:
    def __init__(self, model_name="F5-TTS", device=None, cache_dir=None):
        """
        Initialize the F5-TTS Service.
        
        Args:
            model_name (str): Model name (F5-TTS or E2-TTS)
            device (str): 'cuda' or 'cpu'. Auto-detected if None.
            cache_dir (str): Directory to cache/store model weights.
        """
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.model_name = model_name
        self.target_sample_rate = 24000  # F5-TTS default
        self.n_mel_channels = 100
        self.hop_length = 256
        
        # Setup paths
        if cache_dir:
            self.cache_dir = Path(cache_dir)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
        else:
            self.cache_dir = Path.home() / ".cache" / "f5-tts"
            
        print(f"Initializing F5-TTS on {self.device}...")
        self._load_model()
        
    def _load_model(self):
        """Load the model checkpoints."""
        try:
            # Load Vocabulary/Tokenizer
            # Only typical for F5-TTS setups, might default to pinyin/char for custom
            # For this implementation, we assume standard english/mixed support
            
            # Load the model class based on name
            model_cls = DiT
            model_cfg = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4)
            
            # Weights usually downloaded from HF: SWivid/F5-TTS
            # This is a simplified loader relying on the library's utility if available, 
            # otherwise we might need to fetch from HF explicitly.
            # Here we assume the library's load_checkpoint handles huggingface hub downloads
            # or local paths.
            
            self.model = load_checkpoint(
                self.model_name, 
                ckpt_path=str(self.cache_dir / f"{self.model_name}.pt"), 
                device=self.device,
                dtype=torch.float16 if self.device == 'cuda' else torch.float32
            )
            
            # Load Vocoder (Vocos)
            from f5_tts.infer.utils_infer import load_vocoder
            self.vocoder = load_vocoder(is_local=False) # loads from HF by default
            
            print("F5-TTS Model loaded successfully.")
            
        except Exception as e:
            print(f"Failed to load F5-TTS model: {e}")
            raise

    def generate_voice(self, 
                      text, 
                      ref_audio_path, 
                      ref_text="", 
                      output_path=None, 
                      remove_silence=True,
                      speed=1.0):
        """
        Generate voice cloning audio.
        
        Args:
            text (str): Text to synthesize.
            ref_audio_path (str): Path to reference audio file (10-15s recommended).
            ref_text (str): Transcript of the reference audio. Better quality if provided, otherwise ASR used.
            output_path (str): Path to save the output wav.
            remove_silence (bool): Whether to remove silence from ref audio.
            speed (float): Speed factor (not always supported directly in flow matching, but placeholder).
            
        Returns:
            str: Path to generated audio file.
        """
        if not os.path.exists(ref_audio_path):
            raise FileNotFoundError(f"Reference audio not found: {ref_audio_path}")

        # Basic text preprocessing
        if not text.endswith("."):
            text += "."
            
        # Run Inference
        # Based on standard F5-TTS inference flow
        try:
            # Main inference call
            # This returns (sample_rate, audio_numpy_array) or similar
            audio, sample_rate, _ = infer_process(
                ref_audio_path,
                ref_text,
                text,
                self.model,
                self.vocoder,
                mel_spec_type="vocos",
                speed=speed,
                device=self.device
            )
            
            # Save Output
            if output_path is None:
                output_path = f"output_f5_{os.urandom(4).hex()}.wav"
                
            sf.write(output_path, audio, sample_rate)
            
            return output_path, sample_rate
            
        except Exception as e:
            print(f"Inference error: {e}")
            raise

    def preprocess_audio(self, audio_path):
        """Helper to preprocess reference audio (silence removal, etc)."""
        # This implementation might use tools like ffmpeg or librosa
        pass
