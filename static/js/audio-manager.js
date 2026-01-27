/**
 * Complete Audio Manager for Gaming App
 * Handles background music, sound effects, and muting
 * Works on desktop and mobile with proper fallbacks
 */

class AudioManager {
  constructor(config = {}) {
    this.isMuted = localStorage.getItem('gameMuted') === 'true';
    this.bgMusicVolume = 0.3;
    this.sfxVolume = 0.7;
    
    // Audio elements
    this.bgMusic = null;
    this.sounds = {};
    
    // Mobile support
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    this.isAndroid = /Android/.test(navigator.userAgent);
    
    this.init();
  }

  init() {
    // Get audio elements from DOM
    this.bgMusic = document.getElementById('bgMusic');
    
    // Get all sound effect elements (data-sound attribute)
    const soundElements = document.querySelectorAll('[data-sound]');
    soundElements.forEach(el => {
      const soundName = el.dataset.sound;
      this.sounds[soundName] = el;
    });

    // iOS requires user interaction before audio can play
    if (this.isIOS) {
      document.addEventListener('click', () => {
        this.ensureAudioInitialized();
      }, { once: true });
    }
  }

  ensureAudioInitialized() {
    if (this.bgMusic && this.bgMusic.paused && !this.isMuted) {
      this.bgMusic.play().catch(err => {
        console.log('[AudioManager] Auto-play blocked:', err.message);
      });
    }
  }

  playBg() {
    if (!this.bgMusic || this.isMuted) return;
    
    this.bgMusic.volume = this.bgMusicVolume;
    this.bgMusic.currentTime = 0;
    this.bgMusic.loop = true;
    
    const playPromise = this.bgMusic.play();
    if (playPromise) {
      playPromise.catch(err => {
        console.log('[AudioManager] BG music blocked:', err.message);
      });
    }
  }

  stopBg() {
    if (this.bgMusic) {
      this.bgMusic.pause();
      this.bgMusic.currentTime = 0;
    }
  }

  playSFX(soundName) {
    if (this.isMuted || !this.sounds[soundName]) return;

    const audio = this.sounds[soundName];
    audio.volume = this.sfxVolume;
    audio.currentTime = 0;
    
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(err => {
        console.log(`[AudioManager] SFX '${soundName}' blocked:`, err.message);
      });
    }
  }

  // Common shortcuts
  playWin() { this.playSFX('win'); }
  playLose() { this.playSFX('lose'); }
  playBet() { this.playSFX('bet'); }
  playClick() { this.playSFX('click'); }
  playGameOver() { this.playSFX('gameover'); }

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('gameMuted', this.isMuted);

    if (this.isMuted) {
      this.stopBg();
    } else {
      this.playBg();
    }

    // Dispatch custom event for UI update
    window.dispatchEvent(new CustomEvent('muteToggled', {
      detail: { isMuted: this.isMuted }
    }));
  }

  setVolume(type, volume) {
    if (type === 'bg') {
      this.bgMusicVolume = Math.max(0, Math.min(1, volume));
      if (this.bgMusic) this.bgMusic.volume = this.bgMusicVolume;
    } else if (type === 'sfx') {
      this.sfxVolume = Math.max(0, Math.min(1, volume));
    }
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.audioManager = new AudioManager();
  });
} else {
  window.audioManager = new AudioManager();
}
