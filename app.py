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
import json
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here-change-this-in-production'
app.config['PROPAGATE_EXCEPTIONS'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# Uploads for help attachments
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='threading',
    ping_timeout=60,
    ping_interval=25
)

# --------------------------
# Game configurations
# --------------------------
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

# Store all running tables etc.
game_tables = {}
user_wallets = {}
users_db = {}             # {username: {... profile ...}}
user_game_history = {}    # {user_id: [bet_dict, ...]}
user_complaints = {}      # {user_id: [complaint_dict, ...]}

# --------------------------
# Auth helpers
# --------------------------
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(stored_hash, provided_password):
    return stored_hash == hash_password(provided_password)


def create_user(username, password):
    if username in users_db:
        return False, "Username already exists"

    user_id = f"user_{secrets.token_hex(8)}"
    users_db[username] = {
        'user_id': user_id,
        'username': username,
        'password_hash': hash_password(password),
        'created_at': datetime.now().isoformat(),
        # profile fields
        'display_name': username,
        'email': '',
        'country': '',
        'phone': ''
    }

    user_wallets[user_id] = 10000
    user_game_history[user_id] = []
    user_complaints[user_id] = []
    return True, user_id


def authenticate_user(username, password):
    user = users_db.get(username)
    if not user:
        return False, None
    if verify_password(user['password_hash'], password):
        return True, user['user_id']
    return False, None


def login_required(f):
    from functools import wraps

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)

    return decorated_function


def find_user_by_id(user_id):
    """Helper: find user record in users_db by user_id."""
    for u in users_db.values():
        if u['user_id'] == user_id:
            return u
    return None

# --------------------------
# Game helpers & Table class
# --------------------------
def generate_bot_name():
    prefixes = ['Amit', 'Sanjay', 'Riya', 'Kunal', 'Anita', 'Rohit', 'Meera', 'Neeraj']
    suffix = random.randint(100, 999)
    return f"{random.choice(prefixes)}{suffix}"


class GameTable:
    def __init__(self, game_type, table_number, initial_delay=0):
        self.game_type = game_type
        self.table_number = table_number
        self.round_code = self._make_round_code()
        self.config = GAME_CONFIGS[game_type]
        self.start_time = datetime.now() + timedelta(seconds=initial_delay)
        self.end_time = self.start_time + timedelta(minutes=5)
        self.betting_close_time = self.end_time - timedelta(seconds=15)
        self.bets = []
        self.result = None
        self.is_betting_closed = False
        self.is_finished = False   # <- fixed indentation here
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

        bet_obj = {
            'user_id': user_id,
            'username': username,
            'number': number,
            'is_bot': is_bot,
            'bet_amount': self.config['bet_amount'],
            'bet_time': datetime.now().isoformat()
        }
        self.bets.append(bet_obj)

        # ---------- LOG INTO USER HISTORY (for real users) ----------
        if not is_bot:
            if user_id not in user_game_history:
                user_game_history[user_id] = []
            user_game_history[user_id].append({
                'game_type': self.game_type,
                'round_code': self.round_code,
                'bet_amount': self.config['bet_amount'],
                'number': number,
                'bet_time': datetime.now(),
                'table_number': self.table_number,
                'is_resolved': False  # pending
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
            'bet_amount': self.config['bet_amount'],
            'bet_time': datetime.now().isoformat()
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
        return self.max_players - len(self.bets)

    def is_started(self):
        return datetime.now() >= self.start_time

    def to_dict(self):
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

# --------------------------
# Table setup & threading
# --------------------------
def initialize_game_tables():
    for game_type in GAME_CONFIGS.keys():
        game_tables[game_type] = []
        for i in range(6):
            initial_delay = i * 60
            table = GameTable(game_type, i + 1, initial_delay)
            game_tables[game_type].append(table)
        print(f"Initialized 6 tables for {game_type}")


def manage_game_table(table):
    while True:
        try:
            now = datetime.now()
            if now < table.start_time:
                time.sleep(1)
                continue

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

                # finalize history
                for bet in table.bets:
                    if bet.get('is_bot'):
                        continue
                    for rec in user_game_history.get(bet['user_id'], []):
                        if (not rec.get('is_resolved') and
                            rec['game_type'] == table.game_type and
                            rec['round_code'] == table.round_code and
                            rec['number'] == bet['number']):
                            rec['winning_number'] = result
                            rec['win'] = (bet['number'] == result)
                            rec['status'] = "win" if bet['number'] == result else "lose"
                            rec['amount'] = table.config['payout'] if rec['win'] else -table.config['bet_amount']
                            rec['is_resolved'] = True
                            rec['date_time'] = now.strftime("%Y-%m-%d %H:%M")

                for winner in winners:
                    if winner['user_id'] in user_wallets:
                        user_wallets[winner['user_id']] += winner['payout']

                # Restart round
                time.sleep(3)
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
    for game_type, tables in game_tables.items():
        for table in tables:
            threading.Thread(
                target=manage_game_table,
                args=(table,),
                daemon=True
            ).start()
    print("All game table threads started!")

# --------------------------
# API for tables
# --------------------------
@app.route('/api/tables/<game_type>')
def get_game_tables_api(game_type):
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
    all_tables = {}
    for game_type, tables in game_tables.items():
        all_tables[game_type] = [table.to_dict() for table in tables]
    return jsonify(all_tables)

# --------------------------
# GAME HISTORY API ENDPOINT
# --------------------------
@app.route('/api/user-games')
def user_games_history():
    user_id = request.args.get("user_id")
    user_bets = user_game_history.get(user_id, [])

    grouped = {}
    for b in user_bets:
        key = (b['game_type'], b['round_code'])
        if key not in grouped:
            grouped[key] = {
                'game_type': b['game_type'],
                'round_code': b['round_code'],
                'bet_amount': GAME_CONFIGS[b['game_type']]['bet_amount'],
                'user_bets': [],
                'winning_number': None,
                'date_time': "",
                'status': None,
                'amount': 0
            }
        grouped[key]['user_bets'].append(b['number'])
        if b.get("winning_number") is not None:
            grouped[key]['winning_number'] = b['winning_number']
            grouped[key]['status'] = b['status']
            if b['status'] == "win":
                grouped[key]['amount'] += GAME_CONFIGS[b['game_type']]['payout']
            else:
                grouped[key]['amount'] -= GAME_CONFIGS[b['game_type']]['bet_amount']
        if b.get("date_time"):
            grouped[key]['date_time'] = b.get("date_time", "")

    all_games = list(grouped.values())
    game_history = [g for g in all_games if g.get('status')]
    current_games = [g for g in all_games if not g.get('status')]
    return jsonify({"current_games": current_games, "game_history": game_history})

# -------------
# Auth routes
# -------------
@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('home'))
    return redirect(url_for('login_page'))


@app.route('/login')
def login_page():
    if 'user_id' in session:
        return redirect(url_for('home'))
    return render_template('login.html')


@app.route('/login', methods=['POST'])
def login_post():
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
    """
    GET  -> show registration page (for real user accounts)
    POST -> two behaviours:
            - if 'user_id' present and no 'password' -> game JS wallet registration
            - else -> normal user registration (username + password)
    """
    if request.method == 'GET':
        if 'user_id' in session:
            return redirect(url_for('home'))
        return render_template('register.html')

    # POST
    data = request.get_json() or {}

    # Wallet register (from game JS)
    if data.get('user_id') and not data.get('password'):
        user_id = data.get("user_id")
        username = data.get("username", "Player")
        if user_id not in user_wallets:
            user_wallets[user_id] = 10000
            user_game_history[user_id] = []
            user_complaints[user_id] = []
        return jsonify({'success': True, 'balance': user_wallets[user_id]})

    # Full user registration (from UI)
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
    session.clear()
    return redirect(url_for('login_page'))

# --------------------------
# Game page routes
# --------------------------
@app.route('/home')
@login_required
def home():
    username = session.get('username', 'Player')
    user_id = session.get('user_id')

    if user_id and user_id not in user_wallets:
        user_wallets[user_id] = 10000
        user_game_history[user_id] = []
        user_complaints[user_id] = []

    return render_template('home.html', games=GAME_CONFIGS, username=username)


@app.route('/game/<game_type>')
@login_required
def game_lobby(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template('game-lobby.html', game_type=game_type, game=game)


@app.route('/play/<game_type>')
@login_required
def play_game(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template(f'{game_type}-game.html', game_type=game_type, game=game)


@app.route('/history')
@login_required
def game_history_page():
    return render_template('history.html')


@app.route('/balance/<user_id>')
def get_balance(user_id):
    balance = user_wallets.get(user_id, 0)
    return jsonify({'balance': balance})

# --------------------------
# PROFILE ROUTES
# --------------------------
@app.route('/profile')
@login_required
def profile_page():
    """Profile + coin transactions page."""
    user_id = session.get('user_id')
    username = session.get('username')

    user = find_user_by_id(user_id) or {}
    joined_at = user.get('created_at')
    if joined_at:
        try:
            dt = datetime.fromisoformat(joined_at)
            joined_at_str = dt.strftime("%d %b %Y")
        except Exception:
            joined_at_str = joined_at
    else:
        joined_at_str = "Just now"

    wallet_balance = user_wallets.get(user_id, 0)

    # Build simple coin transactions from user_game_history
    txns = []
    for rec in user_game_history.get(user_id, []):
        cfg = GAME_CONFIGS.get(rec['game_type'], {})
        game_title = cfg.get('name', rec['game_type'])
        bet_amt = rec.get('bet_amount', cfg.get('bet_amount', 0))
        dt_val = rec.get('bet_time', datetime.now())
        if isinstance(dt_val, datetime):
            dt_str = dt_val.isoformat()
        else:
            dt_str = str(dt_val)

        # Bet transaction
        txns.append({
            'kind': 'bet',
            'amount': bet_amt,
            'datetime': dt_str,
            'label': 'Bet',
            'game_title': game_title,
            'note': f"Number {rec['number']}",
            'balance_after': wallet_balance  # approximate
        })

        if rec.get('is_resolved') and rec.get('win'):
            dt2 = rec.get('date_time') or dt_str
            txns.append({
                'kind': 'win',
                'amount': cfg.get('payout', 0),
                'datetime': dt2,
                'label': 'Win',
                'game_title': game_title,
                'note': f"Result {rec.get('winning_number')}",
                'balance_after': wallet_balance
            })

    return render_template(
        'profile.html',
        username=username,
        joined_at=joined_at_str,
        wallet_balance=wallet_balance,
        email=user.get('email', ''),
        country=user.get('country', ''),
        phone=user.get('phone', ''),
        transactions=txns
    )


@app.route('/profile/update', methods=['POST'])
@login_required
def profile_update():
    """Save basic profile fields (in-memory only)."""
    username = session.get('username')
    user = users_db.get(username)

    if not user:
        return jsonify({'success': False, 'message': 'User not found'}), 404

    data = request.get_json() or {}
    user['display_name'] = data.get('displayName', user.get('display_name', username))
    user['email'] = data.get('email', user.get('email', ''))
    user['country'] = data.get('country', user.get('country', ''))
    user['phone'] = data.get('phone', user.get('phone', ''))

    return jsonify({'success': True, 'message': 'Profile updated'})

# --------------------------
# HELP / SUPPORT ROUTES
# --------------------------
@app.route('/help')
@login_required
def help_page():
    """Help & support page."""
    user_id = session.get('user_id')
    username = session.get('username')
    complaints = user_complaints.get(user_id, [])
    return render_template('help.html', username=username, complaints=complaints)


@app.route('/help/submit', methods=['POST'])
@login_required
def help_submit():
    """Receive complaint with optional attachment."""
    user_id = session.get('user_id')
    username = session.get('username')

    if user_id not in user_complaints:
        user_complaints[user_id] = []

    subject = request.form.get('subject', '').strip()
    message = request.form.get('message', '').strip()
    category = request.form.get('category', 'General')

    if not subject:
        return jsonify({'success': False, 'message': 'Please enter a subject'}), 400
    if not message:
        return jsonify({'success': False, 'message': 'Please enter a message'}), 400

    file = request.files.get('attachment')
    saved_name = None
    original_name = None

    if file and file.filename:
        filename = secure_filename(file.filename)
        timestamp = int(time.time())
        saved_name = f"{user_id}_{timestamp}_{filename}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], saved_name))
        original_name = file.filename

    complaint_id = f"C{datetime.now().strftime('%Y%m%d%H%M%S')}{random.randint(100,999)}"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    complaint = {
        'id': complaint_id,
        'subject': subject,
        'message': message,
        'category': category,
        'status': 'Open',
        'created_at': now_str,
        'last_update': now_str,
        'attachment_name': saved_name,
        'original_filename': original_name,
        'updates': [
            {'time': now_str, 'text': 'Complaint created and sent to support.'}
        ]
    }

    user_complaints[user_id].append(complaint)

    return jsonify({'success': True, 'complaint': complaint})

# --------------------------
# Socket.IO handlers
# --------------------------
@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connection_response', {'data': 'Connected'})


@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')


@socketio.on('join_game')
def handle_join_game(data):
    game_type = data.get('game_type')
    user_id = data.get('user_id')
    print(f"User {user_id} joined game {game_type}")
    join_room(game_type)


@socketio.on('place_bet')
def handle_place_bet(data):
    game_type = data.get('game_type')
    user_id = data.get('user_id')
    username = data.get('username')
    number = data.get('number')

    tables = game_tables.get(game_type)
    if not tables:
        emit('bet_error', {'message': 'Invalid game type'})
        return

    table = None
    for t in tables:
        if not t.is_betting_closed and not t.is_finished and len(t.bets) < t.max_players:
            table = t
            break

    if not table:
        emit('bet_error', {'message': 'No open game table'})
        return

    # check wallet
    if user_wallets.get(user_id, 0) < table.config['bet_amount']:
        emit('bet_error', {'message': 'Insufficient balance'})
        return

    success, message = table.add_bet(user_id, username, number)
    if not success:
        emit('bet_error', {'message': message})
    else:
        user_wallets[user_id] -= table.config['bet_amount']
        emit('bet_success', {'message': message, 'new_balance': user_wallets[user_id]})


if __name__ == '__main__':
    # demo user
    create_user('demo', 'demo123')
    print("Demo user created: username='demo', password='demo123'")

    initialize_game_tables()
    start_all_game_tables()

    socketio.run(
        app,
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 10000)),
        debug=False,
        allow_unsafe_werkzeug=True
    )
