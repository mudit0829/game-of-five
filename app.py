from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
import random
import time
from datetime import datetime, timedelta
import threading
import os
import hashlib
import secrets

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here-change-this-in-production'
app.config['PROPAGATE_EXCEPTIONS'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='threading',
    ping_timeout=60,
    ping_interval=25
)

# ---------------------------------------------------
# Game configurations
# ---------------------------------------------------
GAME_CONFIGS = {
    'silver': {
        'bet_amount': 200,
        'payout': 1000,
        'name': 'Silver Game',
        'type': 'number',
        'title': 'Frog Leap',
        'emoji': '🐸'
    },
    'gold': {
        'bet_amount': 250,
        'payout': 1250,
        'name': 'Gold Game',
        'type': 'number',
        'title': 'Football Goal',
        'emoji': '⚽'
    },
    'diamond': {
        'bet_amount': 100,
        'payout': 500,
        'name': 'Diamond Game',
        'type': 'number',
        'title': 'Archer Hit',
        'emoji': '🏹'
    },
    'platinum': {
        'bet_amount': 1000,
        'payout': 5000,
        'name': 'Platinum Game',
        'type': 'number',
        'title': 'Parachute Drop',
        'emoji': '🪂'
    },
    'roulette': {
        'bet_amount': 200,
        'payout': 2000,
        'name': 'Roulette Game',
        'type': 'roulette',
        'title': 'Roulette Spin',
        'emoji': '🎡'
    }
}

# Store all running games - each game type has 6 parallel tables
game_tables = {}  # Format: {game_type: [table1, table2, ...]}
user_wallets = {}
users_db = {}

# ---------------------------------------------------
# Authentication Helpers
# ---------------------------------------------------
def hash_password(password):
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(stored_hash, provided_password):
    """Verify password against stored hash"""
    return stored_hash == hash_password(provided_password)


def create_user(username, password):
    """Create new user account"""
    if username in users_db:
        return False, "Username already exists"
    
    user_id = f"user_{secrets.token_hex(8)}"
    users_db[username] = {
        'user_id': user_id,
        'username': username,
        'password_hash': hash_password(password),
        'created_at': datetime.now().isoformat()
    }
    
    # Initialize wallet
    user_wallets[user_id] = 10000
    
    return True, user_id


def authenticate_user(username, password):
    """Authenticate user credentials"""
    user = users_db.get(username)
    if not user:
        return False, None
    
    if verify_password(user['password_hash'], password):
        return True, user['user_id']
    
    return False, None


def login_required(f):
    """Decorator to require login for routes"""
    from functools import wraps
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function


# ---------------------------------------------------
# Game Helpers
# ---------------------------------------------------
def generate_bot_name():
    prefixes = ['Amit', 'Sanjay', 'Riya', 'Kunal', 'Anita', 'Rohit', 'Meera', 'Neeraj']
    suffix = random.randint(100, 999)
    return f"{random.choice(prefixes)}{suffix}"


class GameTable:
    """Individual game table - 6 tables per game type"""
    def __init__(self, game_type, table_number, initial_delay=0):
        self.game_type = game_type
        self.table_number = table_number
        self.round_code = self._make_round_code()
        self.config = GAME_CONFIGS[game_type]
        
        # Start time with staggered delay (60 seconds per table)
        self.start_time = datetime.now() + timedelta(seconds=initial_delay)
        self.end_time = self.start_time + timedelta(minutes=5)
        self.betting_close_time = self.end_time - timedelta(seconds=15)
        
        self.bets = []
        self.result = None
        self.is_betting_closed = False
        self.is_finished = False
        self.max_players = 6
        self.last_bot_added_at = None

    def _make_round_code(self):
        timestamp = int(time.time())
        return f"{self.game_type[0].upper()}{timestamp}{self.table_number}"

    def get_number_range(self):
        if self.game_type == 'roulette':
            return list(range(37))
        return list(range(10))

    def add_bet(self, user_id, username, number, is_bot=False):
        user_bets = [b for b in self.bets if b['user_id'] == user_id]
        if len(user_bets) >= 4:
            return False, "Maximum 4 bets per user"

        if len(self.bets) >= self.max_players:
            return False, "All slots are full"

        self.bets.append({
            'user_id': user_id,
            'username': username,
            'number': number,
            'is_bot': is_bot,
            'bet_amount': self.config['bet_amount']
        })
        return True, "Bet placed successfully"

    def add_bot_bet(self):
        if len(self.bets) >= self.max_players:
            return False

        all_numbers = self.get_number_range()
        bot_name = generate_bot_name()
        bot_number = random.choice(all_numbers)

        self.bets.append({
            'user_id': f'bot_{bot_name}',
            'username': bot_name,
            'number': bot_number,
            'is_bot': True,
            'bet_amount': self.config['bet_amount']
        })
        return True

    def calculate_result(self):
        real_user_bets = [b for b in self.bets if not b['is_bot']]

        if random.random() < 0.16 and real_user_bets:
            winning_bet = random.choice(real_user_bets)
            self.result = winning_bet['number']
        else:
            all_numbers = self.get_number_range()
            self.result = random.choice(all_numbers)
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
        if now < self.start_time:
            return int((self.end_time - self.start_time).total_seconds())
        if now >= self.end_time:
            return 0
        return int((self.end_time - now).total_seconds())

    def get_slots_available(self):
        """Return available slots"""
        return self.max_players - len(self.bets)

    def is_started(self):
        """Check if game has started"""
        return datetime.now() >= self.start_time

    def to_dict(self):
        """Convert table to dictionary for API"""
        return {
            'table_number': self.table_number,
            'round_code': self.round_code,
            'game_type': self.game_type,
            'players': len(self.bets),
            'max_players': self.max_players,
            'slots_available': self.get_slots_available(),
            'time_remaining': self.get_time_remaining(),
            'is_betting_closed': self.is_betting_closed,
            'is_finished': self.is_finished,
            'is_started': self.is_started(),
            'bets': self.bets,
            'result': self.result
        }


# ---------------------------------------------------
# Initialize Game Tables
# ---------------------------------------------------
def initialize_game_tables():
    """Initialize 6 tables for each game type with staggered start times"""
    for game_type in GAME_CONFIGS.keys():
        game_tables[game_type] = []
        
        for i in range(6):
            # Each table starts 60 seconds after the previous one
            initial_delay = i * 60
            table = GameTable(game_type, i + 1, initial_delay)
            game_tables[game_type].append(table)
        
        print(f"Initialized 6 tables for {game_type}")


# ---------------------------------------------------
# Game Table Management Thread
# ---------------------------------------------------
def manage_game_table(table):
    """Manage individual game table lifecycle"""
    while True:
        try:
            now = datetime.now()
            
            # Wait if game hasn't started yet
            if now < table.start_time:
                time.sleep(1)
                continue
            
            # Add bot bets randomly
            if (
                not table.is_betting_closed
                and len(table.bets) < table.max_players
                and table.get_time_remaining() > 30
            ):
                if (
                    table.last_bot_added_at is None
                    or (now - table.last_bot_added_at).total_seconds() >= 15
                ):
                    if table.add_bot_bet():
                        table.last_bot_added_at = now

            # Close betting
            if now >= table.betting_close_time and not table.is_betting_closed:
                table.is_betting_closed = True
                print(f"{table.game_type} Table {table.table_number}: Betting closed")

            # Finish game
            if now >= table.end_time and not table.is_finished:
                table.is_finished = True
                result = table.calculate_result()
                winners = table.get_winners()
                
                print(f"{table.game_type} Table {table.table_number}: Game ended. Winner: {result}")
                
                # Pay winners
                for winner in winners:
                    if winner['user_id'] in user_wallets:
                        user_wallets[winner['user_id']] += winner['payout']
                
                # Wait 3 seconds then reset
                time.sleep(3)
                
                # Reset table for new round
                table.bets = []
                table.result = None
                table.is_betting_closed = False
                table.is_finished = False
                table.start_time = datetime.now()
                table.end_time = table.start_time + timedelta(minutes=5)
                table.betting_close_time = table.end_time - timedelta(seconds=15)
                table.round_code = table._make_round_code()
                table.last_bot_added_at = None
                
                print(f"{table.game_type} Table {table.table_number}: New round started - {table.round_code}")

            time.sleep(1)

        except Exception as e:
            print(f"Error managing table {table.game_type} #{table.table_number}: {e}")
            time.sleep(1)


def start_all_game_tables():
    """Start management threads for all tables"""
    for game_type, tables in game_tables.items():
        for table in tables:
            threading.Thread(
                target=manage_game_table,
                args=(table,),
                daemon=True
            ).start()
    print("All game table threads started!")


# ---------------------------------------------------
# API Endpoints for Game Tables
# ---------------------------------------------------
@app.route('/api/tables/<game_type>')
def get_game_tables(game_type):
    """Get all tables for a specific game type"""
    if game_type not in GAME_CONFIGS:
        return jsonify({'error': 'Invalid game type'}), 404
    
    tables = game_tables.get(game_type, [])
    tables_data = [table.to_dict() for table in tables]
    
    return jsonify({
        'game_type': game_type,
        'tables': tables_data
    })


@app.route('/api/tables')
def get_all_tables():
    """Get all tables for all game types"""
    all_tables = {}
    for game_type, tables in game_tables.items():
        all_tables[game_type] = [table.to_dict() for table in tables]
    
    return jsonify(all_tables)


# ---------------------------------------------------
# Authentication Routes
# ---------------------------------------------------
@app.route('/')
def index():
    """Redirect to login or home"""
    if 'user_id' in session:
        return redirect(url_for('home'))
    return redirect(url_for('login_page'))


@app.route('/login')
def login_page():
    """Render login page"""
    if 'user_id' in session:
        return redirect(url_for('home'))
    return render_template('login.html')


@app.route('/login', methods=['POST'])
def login_post():
    """Handle login"""
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    remember_me = data.get('remember_me', False)
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required'}), 400
    
    success, user_id = authenticate_user(username, password)
    
    if not success:
        return jsonify({'success': False, 'message': 'Invalid username or password'}), 401
    
    session['user_id'] = user_id
    session['username'] = username
    
    if remember_me:
        session.permanent = True
    
    token = secrets.token_urlsafe(32)
    
    return jsonify({
        'success': True,
        'user_id': user_id,
        'username': username,
        'token': token,
        'redirect': url_for('home')
    })


@app.route('/register', methods=['GET', 'POST'])
def register_page():
    """Handle registration"""
    if request.method == 'GET':
        if 'user_id' in session:
            return redirect(url_for('home'))
        return render_template('register.html')
    
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required'}), 400
    
    if len(password) < 6:
        return jsonify({'success': False, 'message': 'Password must be at least 6 characters'}), 400
    
    success, result = create_user(username, password)
    
    if not success:
        return jsonify({'success': False, 'message': result}), 400
    
    user_id = result
    session['user_id'] = user_id
    session['username'] = username
    
    return jsonify({
        'success': True,
        'user_id': user_id,
        'username': username,
        'redirect': url_for('home')
    })


@app.route('/logout')
def logout():
    """Handle logout"""
    session.clear()
    return redirect(url_for('login_page'))


# ---------------------------------------------------
# Game Routes
# ---------------------------------------------------
@app.route('/home')
@login_required
def home():
    """Home page with game selection"""
    username = session.get('username', 'Player')
    user_id = session.get('user_id')
    
    if user_id and user_id not in user_wallets:
        user_wallets[user_id] = 10000
    
    return render_template('home.html', games=GAME_CONFIGS, username=username)


@app.route('/game/<game_type>')
@login_required
def game_lobby(game_type):
    """Game lobby page with available tables"""
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    
    game = GAME_CONFIGS[game_type]
    return render_template('game-lobby.html', game_type=game_type, game=game)


@app.route('/play/<game_type>')
@login_required
def play_game(game_type):
    """Actual game play page"""
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template(f'{game_type}-game.html', game_type=game_type, game=game)


@app.route('/balance/<user_id>')
def get_balance(user_id):
    """Get user wallet balance"""
    balance = user_wallets.get(user_id, 0)
    return jsonify({'balance': balance})


# ---------------------------------------------------
# Socket.IO handlers
# ---------------------------------------------------
@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connection_response', {'data': 'Connected'})


@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')


if __name__ == '__main__':
    # Create demo user
    create_user('demo', 'demo123')
    print("Demo user created: username='demo', password='demo123'")
    
    # Initialize all game tables
    initialize_game_tables()
    
    # Start table management threads
    start_all_game_tables()
    
    # Run server
    socketio.run(
        app,
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 10000)),
        debug=False,
        allow_unsafe_werkzeug=True
    )
