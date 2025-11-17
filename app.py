from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
import random
import time
from datetime import datetime, timedelta
import threading
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['PROPAGATE_EXCEPTIONS'] = True
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='threading',
    ping_timeout=60,
    ping_interval=25
)

# Game configurations
GAME_CONFIGS = {
    # Frog game
    'silver': {
        'bet_amount': 10,
        'payout': 50,
        'name': 'Silver Game',
        'type': 'number',
        'title': 'Frog Leap',
        'emoji': '🐸'
    },
    'gold': {
        'bet_amount': 50,
        'payout': 250,
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
        'bet_amount': 200,
        'payout': 1000,
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

game_rounds = {}
user_wallets = {}


def generate_bot_name():
    prefixes = ['Amit', 'Sanjay', 'Riya', 'Kunal', 'Anita', 'Rohit', 'Meera', 'Neeraj']
    suffix = random.randint(100, 999)
    return f"{random.choice(prefixes)}{suffix}"


class GameRound:
    def __init__(self, game_type, round_number):
        self.game_type = game_type
        self.round_number = round_number     # simple counter
        self.round_code = self._make_round_code()
        self.config = GAME_CONFIGS[game_type]
        self.start_time = datetime.now()
        self.end_time = self.start_time + timedelta(minutes=5)
        self.betting_close_time = self.start_time + timedelta(minutes=4, seconds=45)
        self.bets = []
        self.result = None
        self.is_betting_closed = False
        self.is_finished = False
        self.real_users = set()
        self.bot_addition_started = False
        self.last_bot_added_at = None

    def _make_round_code(self):
        """
        FYYYYMMDD1000+
        Example: F202511171000, F202511171001 ...
        """
        date_str = datetime.now().strftime('%Y%m%d')
        base = 1000 + self.round_number - 1
        return f"F{date_str}{base}"

    def get_number_range(self):
        if self.game_type == 'roulette':
            return list(range(37))
        return list(range(10))

    def add_bet(self, user_id, username, number, is_bot=False):
        user_bets = [b for b in self.bets if b['user_id'] == user_id]
        if len(user_bets) >= 4:
            return False, "Maximum 4 bets per user"

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
        """Add one bot bet with a number that is not over-used."""
        if len(self.bets) >= 6:
            return False

        all_numbers = self.get_number_range()
        used_numbers = [b['number'] for b in self.bets]
        available_numbers = [n for n in all_numbers if used_numbers.count(n) < 1]

        if not available_numbers:
            available_numbers = all_numbers

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
        real_user_bets = [b for b in self.bets if not b['is_bot']]

        if random.random() < 0.16 and real_user_bets:
            winning_bet = random.choice(real_user_bets)
            self.result = winning_bet['number']
        else:
            bot_bets = [b for b in self.bets if b['is_bot']]
            if bot_bets and random.random() < 0.5:
                winning_bet = random.choice(bot_bets)
                self.result = winning_bet['number']
            else:
                all_numbers = self.get_number_range()
                used_numbers = [b['number'] for b in self.bets]
                available_numbers = [n for n in all_numbers if n not in used_numbers]

                if available_numbers:
                    self.result = random.choice(available_numbers)
                else:
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
        if now >= self.end_time:
            return 0
        return int((self.end_time - now).total_seconds())

    def get_betting_time_remaining(self):
        now = datetime.now()
        if now >= self.betting_close_time:
            return 0
        return int((self.betting_close_time - now).total_seconds())


def get_round_data(game_type):
    current_round = game_rounds.get(game_type)
    if not current_round:
        return None

    return {
        'round_number': current_round.round_number,
        'round_code': current_round.round_code,
        'bets': current_round.bets,
        'time_remaining': current_round.get_time_remaining(),
        'betting_time_remaining': current_round.get_betting_time_remaining(),
        'is_betting_closed': current_round.is_betting_closed,
        'is_finished': current_round.is_finished,
        'config': current_round.config,
        'result': current_round.result,
        'players': len(current_round.real_users)
    }


def game_timer_thread(game_type):
    round_counter = 0

    while True:
        try:
            if game_type not in game_rounds or game_rounds[game_type] is None:
                round_counter += 1
                game_rounds[game_type] = GameRound(game_type, round_counter)
                current_round = game_rounds[game_type]
                print(f"New round started for {game_type} - {current_round.round_code}")

                socketio.emit('new_round', {
                    'game_type': game_type,
                    'round_number': current_round.round_number,
                    'round_code': current_round.round_code,
                    'round_data': get_round_data(game_type)
                }, room=game_type, namespace='/')

            current_round = game_rounds[game_type]
            now = datetime.now()

            time_remaining = current_round.get_time_remaining()
            time_elapsed = (now - current_round.start_time).total_seconds()

            # ---- BOT LOGIC: fill remaining slots between 150s and 30s ----
            if (not current_round.is_betting_closed and
                len(current_round.bets) < 6 and
                30 < time_remaining <= 150):

                if (current_round.last_bot_added_at is None or
                        (now - current_round.last_bot_added_at).total_seconds() >= 15):
                    if current_round.add_bot_bet():
                        current_round.last_bot_added_at = now
                        socketio.emit('bet_placed', {
                            'game_type': game_type,
                            'round_data': get_round_data(game_type)
                        }, room=game_type, namespace='/')

            # close betting
            if now >= current_round.betting_close_time and not current_round.is_betting_closed:
                current_round.is_betting_closed = True
                print(f"Betting closed for {game_type}")
                socketio.emit('betting_closed', {
                    'game_type': game_type
                }, room=game_type, namespace='/')

            # finish round
            if now >= current_round.end_time and not current_round.is_finished:
                current_round.is_finished = True
                result = current_round.calculate_result()
                winners = current_round.get_winners()

                print(f"Game ended for {game_type}. Winning number: {result}")

                for winner in winners:
                    if winner['user_id'] in user_wallets:
                        user_wallets[winner['user_id']] += winner['payout']

                socketio.emit('round_result', {
                    'game_type': game_type,
                    'round_code': current_round.round_code,
                    'result': result,
                    'winners': winners,
                    'all_bets': current_round.bets
                }, room=game_type, namespace='/')

                time.sleep(3)
                game_rounds[game_type] = None

            socketio.emit('timer_update', {
                'game_type': game_type,
                'time_remaining': current_round.get_time_remaining(),
                'betting_time_remaining': current_round.get_betting_time_remaining(),
                'total_bets': len(current_round.bets),
                'players': len(current_round.real_users)
            }, room=game_type, namespace='/')

            time.sleep(1)
        except Exception as e:
            print(f"Error in game timer thread for {game_type}: {e}")
            time.sleep(1)


@app.route('/')
def home():
    return render_template('home.html', games=GAME_CONFIGS)


@app.route('/game/<game_type>')
def game_info(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template('game-info.html', game_type=game_type, game=game)


@app.route('/play/<game_type>')
def play_game(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template(f'{game_type}-game.html', game_type=game_type, game=game)


@app.route('/register', methods=['POST'])
def register():
    data = request.json
    user_id = data.get('user_id')
    username = data.get('username')

    if user_id not in user_wallets:
        user_wallets[user_id] = 10000

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
    print(f'Client connected: {request.sid}')
    emit('connection_response', {'data': 'Connected'})


@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')


@socketio.on('join_game')
def handle_join_game(data):
    game_type = data.get('game_type')
    user_id = data.get('user_id')

    print(f"User {user_id} joining {game_type}")
    join_room(game_type)

    current_round = game_rounds.get(game_type)
    if current_round:
        round_data = get_round_data(game_type)
        emit('round_data', {
            'game_type': game_type,
            'round_data': round_data
        })


@socketio.on('place_bet')
def handle_place_bet(data):
    game_type = data.get('game_type')
    user_id = data.get('user_id')
    username = data.get('username')
    number = data.get('number')

    print(f"Bet received: {username} betting on {number} in {game_type}")

    current_round = game_rounds.get(game_type)

    if not current_round or current_round.is_betting_closed:
        emit('bet_error', {'message': 'Betting is closed'})
        return

    bet_amount = GAME_CONFIGS[game_type]['bet_amount']
    if user_wallets.get(user_id, 0) < bet_amount:
        emit('bet_error', {'message': 'Insufficient balance'})
        return

    user_bets = [b for b in current_round.bets if b['user_id'] == user_id]
    if len(user_bets) >= 4:
        emit('bet_error', {'message': 'Maximum 4 bets per user'})
        return

    success, message = current_round.add_bet(user_id, username, number)

    if success:
        user_wallets[user_id] -= bet_amount

        socketio.emit('bet_placed', {
            'game_type': game_type,
            'round_data': get_round_data(game_type)
        }, room=game_type, namespace='/')

        emit('bet_success', {
            'message': message,
            'new_balance': user_wallets[user_id]
        })
    else:
        emit('bet_error', {'message': message})


def start_game_timers():
  for game_type in GAME_CONFIGS.keys():
      threading.Thread(
          target=game_timer_thread,
          args=(game_type,),
          daemon=True
      ).start()


if __name__ == '__main__':
    start_game_timers()
    socketio.run(
        app,
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 10000)),
        debug=False,
        allow_unsafe_werkzeug=True
    )
