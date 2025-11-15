from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import random
import time
from datetime import datetime, timedelta
import threading
import eventlet

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Game configurations
GAME_CONFIGS = {
    'silver': {'bet_amount': 10, 'payout': 50, 'name': 'Silver Game'},
    'gold': {'bet_amount': 50, 'payout': 200, 'name': 'Gold Game'},
    'diamond': {'bet_amount': 100, 'payout': 500, 'name': 'Diamond Game'},
    'platinum': {'bet_amount': 200, 'payout': 1000, 'name': 'Platinum Game'}
}

# Game states - stores active game rounds
game_rounds = {
    'silver': None,
    'gold': None,
    'diamond': None,
    'platinum': None
}

# User wallets (in production, use database)
user_wallets = {}

# Bot name generator
def generate_bot_name():
    prefixes = ['Player', 'User', 'Gamer', 'Pro', 'King', 'Boss']
    return f"{random.choice(prefixes)}{random.randint(1000, 9999)}"

class GameRound:
    def __init__(self, game_type):
        self.game_type = game_type
        self.config = GAME_CONFIGS[game_type]
        self.start_time = datetime.now()
        self.end_time = self.start_time + timedelta(minutes=5)
        self.betting_close_time = self.start_time + timedelta(minutes=4, seconds=45)
        self.bets = []  # List of {user_id, username, number, is_bot}
        self.result = None
        self.is_betting_closed = False
        self.is_finished = False
        self.real_users = set()
        self.bot_addition_started = False
        
    def add_bet(self, user_id, username, number, is_bot=False):
        # Check if user already has 4 bets
        user_bets = [b for b in self.bets if b['user_id'] == user_id]
        if len(user_bets) >= 4:
            return False, "Maximum 4 bets per user"
        
        # Check if 6 slots are full
        if len(self.bets) >= 6:
            return False, "All slots are full"
        
        if not is_bot:
            self.real_users.add(user_id)
        
        self.bets.append({
            'user_id': user_id,
            'username': username,
            'number': number,
            'is_bot': is_bot,
            'bet_amount': self.config['bet_amount']
        })
        return True, "Bet placed successfully"
    
    def add_bot_bet(self):
        if len(self.bets) >= 6:
            return False
        
        # Get numbers already bet on
        used_numbers = [b['number'] for b in self.bets]
        available_numbers = [n for n in range(10) if used_numbers.count(n) < 1]
        
        if not available_numbers:
            available_numbers = list(range(10))
        
        bot_name = generate_bot_name()
        bot_number = random.choice(available_numbers)
        
        self.bets.append({
            'user_id': f'bot_{bot_name}',
            'username': bot_name,
            'number': bot_number,
            'is_bot': True,
            'bet_amount': self.config['bet_amount']
        })
        return True
    
    def calculate_result(self):
        # Real user win probability: 16%
        real_user_bets = [b for b in self.bets if not b['is_bot']]
        
        if random.random() < 0.16 and real_user_bets:
            # Real user wins - pick random bet from real users
            winning_bet = random.choice(real_user_bets)
            self.result = winning_bet['number']
        else:
            # House wins or bot wins
            bot_bets = [b for b in self.bets if b['is_bot']]
            
            if bot_bets and random.random() < 0.5:
                # Bot wins
                winning_bet = random.choice(bot_bets)
                self.result = winning_bet['number']
            else:
                # No one wins - pick number with no bets
                used_numbers = [b['number'] for b in self.bets]
                available_numbers = [n for n in range(10) if n not in used_numbers]
                
                if available_numbers:
                    self.result = random.choice(available_numbers)
                else:
                    # All numbers covered, pick random
                    self.result = random.randint(0, 9)
        
        return self.result
    
    def get_winners(self):
        if self.result is None:
            return []
        
        winners = []
        for bet in self.bets:
            if bet['number'] == self.result and not bet['is_bot']:
                winners.append({
                    'user_id': bet['user_id'],
                    'username': bet['username'],
                    'payout': self.config['payout']
                })
        return winners
    
    def get_time_remaining(self):
        now = datetime.now()
        if now >= self.end_time:
            return 0
        return int((self.end_time - now).total_seconds())
    
    def get_betting_time_remaining(self):
        now = datetime.now()
        if now >= self.betting_close_time:
            return 0
        return int((self.betting_close_time - now).total_seconds())

def game_timer_thread(game_type):
    """Manages game round lifecycle"""
    while True:
        if game_rounds[game_type] is None:
            # Create new round
            game_rounds[game_type] = GameRound(game_type)
            socketio.emit('new_round', {
                'game_type': game_type,
                'round_data': get_round_data(game_type)
            }, room=game_type)
        
        current_round = game_rounds[game_type]
        now = datetime.now()
        
        # Check if we need to add bots (after 4 minutes, if only 1 real user)
        time_elapsed = (now - current_round.start_time).total_seconds()
        
        if (time_elapsed >= 240 and 
            len(current_round.real_users) == 1 and 
            not current_round.bot_addition_started):
            current_round.bot_addition_started = True
            threading.Thread(target=add_bots_gradually, args=(game_type,)).start()
        
        # Close betting at 4:45
        if now >= current_round.betting_close_time and not current_round.is_betting_closed:
            current_round.is_betting_closed = True
            socketio.emit('betting_closed', {
                'game_type': game_type
            }, room=game_type)
        
        # Calculate and announce result at 5:00
        if now >= current_round.end_time and not current_round.is_finished:
            current_round.is_finished = True
            result = current_round.calculate_result()
            winners = current_round.get_winners()
            
            # Update winner wallets
            for winner in winners:
                if winner['user_id'] in user_wallets:
                    user_wallets[winner['user_id']] += winner['payout']
            
            socketio.emit('round_result', {
                'game_type': game_type,
                'result': result,
                'winners': winners,
                'all_bets': current_round.bets
            }, room=game_type)
            
            # Wait 10 seconds before starting new round
            eventlet.sleep(10)
            game_rounds[game_type] = None
        
        # Update timer every second
        socketio.emit('timer_update', {
            'game_type': game_type,
            'time_remaining': current_round.get_time_remaining(),
            'betting_time_remaining': current_round.get_betting_time_remaining()
        }, room=game_type)
        
        eventlet.sleep(1)

def add_bots_gradually(game_type):
    """Add bots every 5-7 seconds"""
    current_round = game_rounds[game_type]
    
    while (current_round and 
           not current_round.is_betting_closed and 
           len(current_round.bets) < 6):
        
        eventlet.sleep(random.uniform(5, 7))
        
        if current_round.add_bot_bet():
            socketio.emit('bet_placed', {
                'game_type': game_type,
                'round_data': get_round_data(game_type)
            }, room=game_type)

def get_round_data(game_type):
    """Get current round data"""
    current_round = game_rounds[game_type]
    if not current_round:
        return None
    
    return {
        'bets': current_round.bets,
        'time_remaining': current_round.get_time_remaining(),
        'betting_time_remaining': current_round.get_betting_time_remaining(),
        'is_betting_closed': current_round.is_betting_closed,
        'is_finished': current_round.is_finished,
        'config': current_round.config
    }

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    user_id = data.get('user_id')
    username = data.get('username')
    
    if user_id not in user_wallets:
        user_wallets[user_id] = 10000  # Starting balance
    
    return jsonify({
        'success': True,
        'balance': user_wallets[user_id]
    })

@app.route('/balance/<user_id>')
def get_balance(user_id):
    balance = user_wallets.get(user_id, 0)
    return jsonify({'balance': balance})

@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('join_game')
def handle_join_game(data):
    game_type = data['game_type']
    user_id = data['user_id']
    
    join_room(game_type)
    
    # Send current round data
    round_data = get_round_data(game_type)
    emit('round_data', {
        'game_type': game_type,
        'round_data': round_data
    })

@socketio.on('place_bet')
def handle_place_bet(data):
    game_type = data['game_type']
    user_id = data['user_id']
    username = data['username']
    number = data['number']
    
    current_round = game_rounds[game_type]
    
    if not current_round or current_round.is_betting_closed:
        emit('bet_error', {'message': 'Betting is closed'})
        return
    
    # Check balance
    bet_amount = GAME_CONFIGS[game_type]['bet_amount']
    if user_wallets.get(user_id, 0) < bet_amount:
        emit('bet_error', {'message': 'Insufficient balance'})
        return
    
    # Place bet
    success, message = current_round.add_bet(user_id, username, number)
    
    if success:
        user_wallets[user_id] -= bet_amount
        
        # Broadcast to all users in the room
        socketio.emit('bet_placed', {
            'game_type': game_type,
            'round_data': get_round_data(game_type)
        }, room=game_type)
        
        emit('bet_success', {
            'message': message,
            'new_balance': user_wallets[user_id]
        })
    else:
        emit('bet_error', {'message': message})

# Start game timers in background
def start_game_timers():
    for game_type in GAME_CONFIGS.keys():
        eventlet.spawn(game_timer_thread, game_type)

if __name__ == '__main__':
    start_game_timers()
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
