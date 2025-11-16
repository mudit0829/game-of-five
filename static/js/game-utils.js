/**
 * BetGames - Shared Game Configuration & Utils
 * Used by all game pages for consistent behavior
 */

// ============================================
// GAME CONFIGURATION
// ============================================

const GAMES_CONFIG = {
    silver: {
        id: 'silver',
        title: 'Frog Leap',
        emoji: '🐸',
        bet_amount: 10,
        payout: 50,
        description: 'Help the frog find its way',
        color_primary: '#87ceeb',
        color_secondary: '#90ee90',
        color_accent: '#4ecca3',
        min_players: 1,
        max_players: 6,
        max_bets_per_user: 4,
        win_probability: 0.16
    },
    gold: {
        id: 'gold',
        title: 'Football Goal',
        emoji: '⚽',
        bet_amount: 50,
        payout: 200,
        description: 'Score the winning goal',
        color_primary: '#90ee90',
        color_secondary: '#ffd700',
        color_accent: '#ffed4e',
        min_players: 1,
        max_players: 6,
        max_bets_per_user: 4,
        win_probability: 0.16
    },
    diamond: {
        id: 'diamond',
        title: 'Archer Hit',
        emoji: '🏹',
        bet_amount: 100,
        payout: 500,
        description: 'Hit the perfect bullseye',
        color_primary: '#87ceeb',
        color_secondary: '#d3d3d3',
        color_accent: '#b9f2ff',
        min_players: 1,
        max_players: 6,
        max_bets_per_user: 4,
        win_probability: 0.16
    },
    platinum: {
        id: 'platinum',
        title: 'Parachute Drop',
        emoji: '🪂',
        bet_amount: 200,
        payout: 1000,
        description: 'Land on the winning boat',
        color_primary: '#1e90ff',
        color_secondary: '#20b2aa',
        color_accent: '#e5e4e2',
        min_players: 1,
        max_players: 6,
        max_bets_per_user: 4,
        win_probability: 0.16
    },
    roulette: {
        id: 'roulette',
        title: 'Roulette Spin',
        emoji: '🎡',
        bet_amount: 50,
        payout: 1750,
        description: 'Spin to win big',
        color_primary: '#1a1a2e',
        color_secondary: '#ff0000',
        color_accent: '#ffd700',
        min_players: 1,
        max_players: 6,
        max_bets_per_user: 4,
        win_probability: 0.16,
        numbers: 37  // 0-36
    }
};

// ============================================
// GAME STATE MANAGER
// ============================================

class GameStateManager {
    constructor(gameType) {
        this.gameType = gameType;
        this.config = GAMES_CONFIG[gameType];
        this.userId = localStorage.getItem('userId');
        this.username = localStorage.getItem('username');
        this.socket = null;
        this.userBets = [];
        this.gameState = {
            round: 0,
            timer: 300,
            betting_time: 15,
            is_betting_closed: false,
            is_finished: false,
            balance: 0,
            all_bets: [],
            result: null
        };
    }

    initSocket() {
        this.socket = io();
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.socket.emit('join_game', {
            game_type: this.gameType,
            user_id: this.userId
        });

        this.socket.on('timer_update', (data) => this.onTimerUpdate(data));
        this.socket.on('bet_placed', (data) => this.onBetPlaced(data));
        this.socket.on('round_result', (data) => this.onRoundResult(data));
        this.socket.on('betting_closed', (data) => this.onBettingClosed(data));
        this.socket.on('new_round', (data) => this.onNewRound(data));
        this.socket.on('bet_success', (data) => this.onBetSuccess(data));
        this.socket.on('bet_error', (data) => this.onBetError(data));
    }

    placeBet(number) {
        if (this.userBets.length >= this.config.max_bets_per_user) {
            throw new Error(`Maximum ${this.config.max_bets_per_user} bets allowed`);
        }
        if (this.userBets.includes(number)) {
            throw new Error('Already bet on this number');
        }
        if (this.gameState.is_betting_closed) {
            throw new Error('Betting is closed');
        }

        this.socket.emit('place_bet', {
            game_type: this.gameType,
            user_id: this.userId,
            username: this.username,
            number: number
        });

        this.userBets.push(number);
    }

    onTimerUpdate(data) {
        if (data.game_type !== this.gameType) return;
        
        this.gameState.timer = data.time_remaining;
        this.gameState.betting_time = data.betting_time_remaining;
        
        if (this.onTimerUpdate.callback) {
            this.onTimerUpdate.callback(data);
        }
    }

    onBetPlaced(data) {
        if (data.game_type !== this.gameType) return;
        
        this.gameState.all_bets = data.round_data.bets;
        
        if (this.onBetPlaced.callback) {
            this.onBetPlaced.callback(data);
        }
    }

    onRoundResult(data) {
        if (data.game_type !== this.gameType) return;
        
        this.gameState.result = data.result;
        this.gameState.is_finished = true;
        
        if (this.onRoundResult.callback) {
            this.onRoundResult.callback(data);
        }
    }

    onBettingClosed(data) {
        if (data.game_type !== this.gameType) return;
        
        this.gameState.is_betting_closed = true;
        
        if (this.onBettingClosed.callback) {
            this.onBettingClosed.callback(data);
        }
    }

    onNewRound(data) {
        if (data.game_type !== this.gameType) return;
        
        this.userBets = [];
        this.gameState.round = data.round_number;
        this.gameState.is_betting_closed = false;
        this.gameState.is_finished = false;
        this.gameState.result = null;
        
        if (this.onNewRound.callback) {
            this.onNewRound.callback(data);
        }
    }

    onBetSuccess(data) {
        this.gameState.balance = data.new_balance;
        
        if (this.onBetSuccess.callback) {
            this.onBetSuccess.callback(data);
        }
    }

    onBetError(data) {
        if (this.onBetError.callback) {
            this.onBetError.callback(data);
        }
        throw new Error(data.message);
    }
}

// ============================================
// UI HELPER FUNCTIONS
// ============================================

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatCurrency(amount) {
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function showMessage(message, isError = false, duration = 2500) {
    const messageBox = document.getElementById('messageBox');
    if (!messageBox) return;
    
    messageBox.textContent = message;
    messageBox.classList.toggle('error', isError);
    messageBox.classList.add('show');
    
    setTimeout(() => {
        messageBox.classList.remove('show');
    }, duration);
}

function goBack() {
    window.location.href = '/';
}

function updateBalance(amount) {
    const balanceEl = document.getElementById('balance');
    if (balanceEl) {
        balanceEl.textContent = formatCurrency(amount);
    }
}

function updateTimer(timeRemaining, bettingTimeRemaining) {
    const timerEl = document.getElementById('timer');
    if (!timerEl) return;
    
    const time = bettingTimeRemaining || timeRemaining;
    timerEl.textContent = formatTime(time);
    
    if (time <= 15 && time > 0) {
        timerEl.classList.add('warning');
    } else {
        timerEl.classList.remove('warning');
    }
}

// ============================================
// ANIMATION HELPERS
// ============================================

class AnimationController {
    static animate(element, animationName, duration = 1000) {
        return new Promise((resolve) => {
            element.style.animation = `${animationName} ${duration}ms ease-out forwards`;
            setTimeout(() => {
                element.style.animation = '';
                resolve();
            }, duration);
        });
    }

    static fadeIn(element, duration = 300) {
        element.style.opacity = '0';
        element.style.transition = `opacity ${duration}ms ease-out`;
        setTimeout(() => {
            element.style.opacity = '1';
        }, 10);
    }

    static fadeOut(element, duration = 300) {
        element.style.opacity = '1';
        element.style.transition = `opacity ${duration}ms ease-out`;
        element.style.opacity = '0';
    }

    static scale(element, fromScale = 0.8, toScale = 1, duration = 300) {
        element.style.transform = `scale(${fromScale})`;
        element.style.transition = `transform ${duration}ms ease-out`;
        setTimeout(() => {
            element.style.transform = `scale(${toScale})`;
        }, 10);
    }

    static bounce(element) {
        element.style.animation = 'bounce 0.5s ease-out';
        setTimeout(() => {
            element.style.animation = '';
        }, 500);
    }

    static shake(element, duration = 200) {
        element.style.animation = `shake ${duration}ms ease-in-out`;
        setTimeout(() => {
            element.style.animation = '';
        }, duration);
    }
}

// ============================================
// INITIALIZATION HELPER
// ============================================

async function initializeGamePage(gameType, onReady) {
    try {
        // Check user is logged in
        const userId = localStorage.getItem('userId');
        if (!userId) {
            window.location.href = '/';
            return;
        }

        // Register user
        const response = await fetch('/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: userId,
                username: localStorage.getItem('username')
            })
        });

        if (!response.ok) throw new Error('Registration failed');

        const data = await response.json();

        // Initialize game state
        const gameState = new GameStateManager(gameType);
        gameState.gameState.balance = data.balance;
        gameState.initSocket();

        // Update balance display
        updateBalance(data.balance);

        // Call ready callback
        if (onReady) {
            onReady(gameState);
        }

        return gameState;

    } catch (error) {
        console.error('Game initialization error:', error);
        showMessage('Failed to initialize game', true);
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
    }
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // ESC to go back
        if (e.key === 'Escape') {
            goBack();
        }
        
        // SPACE to show help
        if (e.key === ' ') {
            e.preventDefault();
            showMessage('ℹ️ Click numbers/slots to place bets. Max 4 per game.');
        }
    });
}

// ============================================
// PERFORMANCE MONITORING
// ============================================

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            socketLatency: [],
            renderTime: [],
            memoryUsage: []
        };
    }

    recordSocketLatency(latency) {
        this.metrics.socketLatency.push(latency);
    }

    recordRenderTime(time) {
        this.metrics.renderTime.push(time);
    }

    getAverageLatency() {
        const arr = this.metrics.socketLatency;
        return arr.length ? (arr.reduce((a, b) => a + b) / arr.length).toFixed(0) : 0;
    }

    getAverageRenderTime() {
        const arr = this.metrics.renderTime;
        return arr.length ? (arr.reduce((a, b) => a + b) / arr.length).toFixed(0) : 0;
    }

    logMetrics() {
        console.log('BetGames Performance Metrics:');
        console.log(`  Socket Latency: ${this.getAverageLatency()}ms`);
        console.log(`  Render Time: ${this.getAverageRenderTime()}ms`);
        console.log(`  Active Bets: ${this.metrics.socketLatency.length}`);
    }
}

// Export for use in game pages
const gameUtils = {
    GAMES_CONFIG,
    GameStateManager,
    AnimationController,
    PerformanceMonitor,
    formatTime,
    formatCurrency,
    showMessage,
    goBack,
    updateBalance,
    updateTimer,
    initializeGamePage,
    setupKeyboardShortcuts
};
