from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    redirect,
    url_for,
    session,
)
from flask_sqlalchemy import SQLAlchemy
from flask_socketio import SocketIO, emit, join_room
from flask_cors import CORS
from datetime import datetime, timedelta
from functools import wraps
import threading
import random
import time
import os
import hashlib
import secrets

# ---------------------------------------------------
# Flask / DB / Socket setup
# ---------------------------------------------------

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "your-secret-key-here-change-this-in-production")
app.config["PROPAGATE_EXCEPTIONS"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

# DB config - uses sqlite in current directory
db_path = os.path.join(os.path.dirname(__file__), "game.db")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    ping_timeout=60,
    ping_interval=25,
)

# ---------------------------------------------------
# Super Admin credentials (CHANGE THESE!)
# ---------------------------------------------------

SUPERADMIN_USERNAME = "superadmin"  # ✅ Change this
SUPERADMIN_PASSWORD = "SuperPass@2026"  # ✅ Change this
APP_TIMEZONE = "Asia/Kolkata"

# forced_winners: (game_type, round_code) -> int forced_number
forced_winners = {}

# ---------------------------------------------------
# Game configurations
# ---------------------------------------------------

GAME_CONFIGS = {
    "silver": {
        "bet_amount": 10,
        "payout": 50,
        "name": "Silver Game",
        "type": "number",
        "title": "Frog Leap",
        "emoji": "🐸",
    },
    "gold": {
        "bet_amount": 50,
        "payout": 250,
        "name": "Gold Game",
        "type": "number",
        "title": "Football Goal",
        "emoji": "⚽",
    },
    "diamond": {
        "bet_amount": 100,
        "payout": 500,
        "name": "Diamond Game",
        "type": "number",
        "title": "Archer Hit",
        "emoji": "🏹",
    },
    "platinum": {
        "bet_amount": 200,
        "payout": 1000,
        "name": "Platinum Game",
        "type": "number",
        "title": "Parachute Drop",
        "emoji": "🪂",
    },
    "roulette": {
        "bet_amount": 200,
        "payout": 2000,
        "name": "Roulette Game",
        "type": "roulette",
        "title": "Roulette Spin",
        "emoji": "🎡",
    },
}

# ---------------------------------------------------
# SQLAlchemy Models
# ---------------------------------------------------


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    display_name = db.Column(db.String(120))
    email = db.Column(db.String(200))
    country = db.Column(db.String(100))
    phone = db.Column(db.String(50))

    # Admin fields
    is_admin = db.Column(db.Boolean, default=False)
    is_blocked = db.Column(db.Boolean, default=False)
    block_reason = db.Column(db.Text)

    wallet = db.relationship("Wallet", backref="user", uselist=False)
    tickets = db.relationship("Ticket", backref="user", lazy=True)

    def set_password(self, password: str):
        self.password_hash = hashlib.sha256(password.encode()).hexdigest()

    def check_password(self, password: str) -> bool:
        return self.password_hash == hashlib.sha256(password.encode()).hexdigest()


class Wallet(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    balance = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Ticket(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    subject = db.Column(db.String(200))
    message = db.Column(db.Text)
    status = db.Column(db.String(20), default="open")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    attachment_name = db.Column(db.String(255))


class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    kind = db.Column(db.String(50), nullable=False)  # 'bet', 'win', 'added', 'redeem'
    amount = db.Column(db.Integer, nullable=False)
    balance_after = db.Column(db.Integer, nullable=False)
    label = db.Column(db.String(100))
    game_title = db.Column(db.String(100))
    note = db.Column(db.Text)
    datetime = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class ForcedWinnerHistory(db.Model):
    """History of all forced winner bets set by Super Admin"""
    id = db.Column(db.Integer, primary_key=True)
    round_code = db.Column(db.String(100), nullable=False, index=True)
    game_type = db.Column(db.String(50), nullable=False)
    game_name = db.Column(db.String(100))
    table_number = db.Column(db.Integer)
    forced_number = db.Column(db.Integer, nullable=False)
    round_start_time = db.Column(db.DateTime, nullable=False)
    forced_at = db.Column(db.DateTime, default=datetime.utcnow)
    forced_by = db.Column(db.String(100))
    status = db.Column(db.String(20), default="active")  # active, cleared, executed
    note = db.Column(db.Text)


# ---------------------------------------------------
# In-memory structures
# ---------------------------------------------------

game_tables = {}
user_game_history = {}

# ---------------------------------------------------
# Round scheduling + predictable round_code
# ---------------------------------------------------

ROUND_SECONDS = 300  # 5 minutes


def _floor_epoch(ts: int, period: int) -> int:
    return ts - (ts % period)


def floor_to_period(dt: datetime, period_seconds: int) -> datetime:
    ts = int(dt.timestamp())
    floored = _floor_epoch(ts, period_seconds)
    return datetime.fromtimestamp(floored)


def make_round_code(game_type: str, start_time: datetime, table_number: int) -> str:
    # Required format: R_20260216_1330_1 (R = initial letter of game type)
    initial = (game_type or "X")[0].upper()
    stamp = start_time.strftime("%Y%m%d_%H%M")
    return f"{initial}_{stamp}_{int(table_number)}"


# ---------------------------------------------------
# Helpers
# ---------------------------------------------------


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)

    return decorated


def admin_required(f):
    """Check if user is logged in AND is admin"""

    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login_page"))

        user = User.query.get(session.get("user_id"))
        if not user:
            session.clear()
            return redirect(url_for("login_page"))

        if not user.is_admin:
            if request.path.startswith("/api/admin/"):
                return jsonify({"error": "Admin access required"}), 403
            session.clear()
            return redirect(url_for("login_page"))

        return f(*args, **kwargs)

    return decorated


def superadmin_required(f):
    """Check if user is logged in as super admin"""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "is_superadmin" not in session or not session.get("is_superadmin"):
            if request.path.startswith("/api/sa/"):
                return jsonify({"error": "Super admin access required"}), 403
            return redirect(url_for("sa_login_page"))
        return f(*args, **kwargs)
    return decorated


def ensure_wallet_for_user(user: User) -> Wallet:
    """Ensure the user has a wallet row with starting 10000 coins - ONLY FOR NON-ADMIN USERS"""
    if user.is_admin:
        return None
    if not user.wallet:
        wallet = Wallet(user_id=user.id, balance=10000)
        db.session.add(wallet)
        db.session.commit()
        return wallet
    return user.wallet


def generate_bot_name():
    prefixes = ["Amit", "Sanjay", "Riya", "Kunal", "Anita", "Rohit", "Meera", "Neeraj"]
    suffix = random.randint(100, 999)
    return f"{random.choice(prefixes)}{suffix}"


# ---------------------------------------------------
# GameTable class
# ---------------------------------------------------


class GameTable:
    def __init__(self, game_type, table_number, initial_delay=0):
        self.game_type = game_type
        self.table_number = table_number
        self.config = GAME_CONFIGS[game_type]

        # predictable schedule:
        base = floor_to_period(datetime.now(), ROUND_SECONDS)
        self.start_time = base + timedelta(seconds=initial_delay)
        self.end_time = self.start_time + timedelta(seconds=ROUND_SECONDS)
        self.betting_close_time = self.end_time - timedelta(seconds=15)

        self.round_code = make_round_code(self.game_type, self.start_time, self.table_number)

        self.bets = []
        self.result = None
        self.is_betting_closed = False
        self.is_finished = False

        # roulette needs 37 unique numbers, other games keep 6
        self.max_players = 37 if self.game_type == "roulette" else 6

        self.last_bot_added_at = None

    def get_number_range(self):
        if self.game_type == "roulette":
            return list(range(37))
        return list(range(10))

    def add_bet(self, user_id, username, number, is_bot=False):
        try:
            number_int = int(number)
        except (TypeError, ValueError):
            return False, "Invalid number"
        number = number_int

        # Unique number per round/table
        for bet in self.bets:
            if bet["number"] == number:
                return False, "This number is already taken in this game. Please choose another."

        if not is_bot:
            try:
                user_id_norm = int(user_id)
            except (TypeError, ValueError):
                user_id_norm = user_id
        else:
            user_id_norm = user_id

        user_bets = [b for b in self.bets if b["user_id"] == user_id_norm]

        # roulette allows more picks, other games unchanged
        max_bets_per_user = 20 if self.game_type == "roulette" else 3
        if len(user_bets) >= max_bets_per_user:
            return False, f"Maximum {max_bets_per_user} bets per user"

        if len(self.bets) >= self.max_players:
            return False, "All slots are full"

        bet_obj = {
            "user_id": user_id_norm,
            "username": username,
            "number": number,
            "is_bot": is_bot,
            "bet_amount": self.config["bet_amount"],
            "bet_time": datetime.now(),
        }
        self.bets.append(bet_obj)

        if not is_bot:
            if user_id_norm not in user_game_history:
                user_game_history[user_id_norm] = []
            user_game_history[user_id_norm].append(
                {
                    "game_type": self.game_type,
                    "round_code": self.round_code,
                    "bet_amount": self.config["bet_amount"],
                    "number": number,
                    "bet_time": datetime.now(),
                    "table_number": self.table_number,
                    "is_resolved": False,
                }
            )

        return True, "Bet placed successfully"

    def add_bot_bet(self):
        if len(self.bets) >= self.max_players:
            return False

        taken_numbers = {b["number"] for b in self.bets}
        all_numbers = self.get_number_range()
        available_numbers = [n for n in all_numbers if n not in taken_numbers]
        if not available_numbers:
            return False

        bot_name = generate_bot_name()
        bot_number = random.choice(available_numbers)

        success, _ = self.add_bet(
            user_id=f"bot_{bot_name}",
            username=bot_name,
            number=bot_number,
            is_bot=True,
        )
        return success

    def calculate_result(self):
        """Calculate result using normal logic (ignores forced winners - handled separately)"""
        bet_numbers = [b.get("number") for b in (self.bets or []) if b.get("number") is not None]

        if not bet_numbers:
            self.result = random.choice(self.get_number_range())
            return self.result

        real_numbers = [
            b.get("number")
            for b in (self.bets or [])
            if (not b.get("is_bot")) and b.get("number") is not None
        ]

        if real_numbers and random.random() < 0.16:
            self.result = random.choice(real_numbers)
        else:
            self.result = random.choice(bet_numbers)

        return self.result

    def get_winners(self):
        if self.result is None:
            return []
        winners = []
        for bet in self.bets:
            if bet["number"] == self.result and not bet["is_bot"]:
                winners.append(
                    {
                        "user_id": bet["user_id"],
                        "username": bet["username"],
                        "payout": self.config["payout"],
                    }
                )
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
            "table_number": self.table_number,
            "round_code": self.round_code,
            "game_type": self.game_type,
            "players": len(self.bets),
            "max_players": self.max_players,
            "slots_available": self.get_slots_available(),
            "time_remaining": self.get_time_remaining(),
            "is_betting_closed": self.is_betting_closed,
            "is_finished": self.is_finished,
            "is_started": self.is_started(),
            "bets": self.bets,
            "result": self.result,
        }


# ---------------------------------------------------
# Table initialization
# ---------------------------------------------------


def initialize_game_tables():
    for game_type in GAME_CONFIGS.keys():
        game_tables[game_type] = []
        for i in range(6):
            initial_delay = i * 60  # stagger 1 minute each
            table = GameTable(game_type, i + 1, initial_delay)
            game_tables[game_type].append(table)
        print(f"Initialized 6 tables for {game_type}")


def manage_game_table(table: GameTable):
    with app.app_context():
        while True:
            try:
                now = datetime.now()

                if now < table.start_time:
                    time.sleep(1)
                    continue

                # Add bots while betting open
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

                # ✅ PRE-SELECT RESULT at <= 2 seconds remaining (for UI animation)
                if (
                    (not table.is_finished)
                    and (table.result is None)
                    and (len(table.bets) > 0)
                    and (table.get_time_remaining() <= 2)
                ):
                    # ✅ Check if forced winner exists
                    forced = forced_winners.get((table.game_type, table.round_code))
                    if forced is not None:
                        bet_numbers = {b.get("number") for b in (table.bets or [])}
                        # Only use forced if someone bet on it, else random
                        table.result = forced if forced in bet_numbers else table.calculate_result()
                        print(f"⚠️  {table.game_type} Table {table.table_number}: FORCED winner {forced} (bet exists: {forced in bet_numbers})")
                    else:
                        table.result = table.calculate_result()

                    print(
                        f"{table.game_type} Table {table.table_number}: Pre-selected winner at <=2s: {table.result}"
                    )

                # Finish game at end_time
                if now >= table.end_time and not table.is_finished:
                    table.is_finished = True

                    if table.result is None:
                        forced = forced_winners.get((table.game_type, table.round_code))
                        if forced is not None:
                            bet_numbers = {b.get("number") for b in (table.bets or [])}
                            table.result = forced if forced in bet_numbers else table.calculate_result()
                        else:
                            table.result = table.calculate_result()

                    result = table.result
                    winners = table.get_winners()
                    print(
                        f"{table.game_type} Table {table.table_number}: Game ended. Winner: {result}"
                    )

                    # History update
                    for bet in table.bets:
                        if bet.get("is_bot"):
                            continue

                        uid = bet["user_id"]
                        for rec in user_game_history.get(uid, []):
                            if (
                                not rec.get("is_resolved")
                                and rec["game_type"] == table.game_type
                                and rec["round_code"] == table.round_code
                                and rec["number"] == bet["number"]
                            ):
                                rec["winning_number"] = result
                                rec["win"] = bet["number"] == result
                                rec["status"] = "win" if rec["win"] else "lose"
                                rec["amount"] = (
                                    table.config["payout"]
                                    if rec["win"]
                                    else -table.config["bet_amount"]
                                )
                                rec["is_resolved"] = True
                                rec["date_time"] = now.strftime("%Y-%m-%d %H:%M")

                    # Winners payout + transaction log
                    for winner in winners:
                        wallet = Wallet.query.filter_by(user_id=winner["user_id"]).first()
                        if wallet:
                            wallet.balance += winner["payout"]

                        win_tx = Transaction(
                            user_id=winner["user_id"],
                            kind="win",
                            amount=winner["payout"],
                            balance_after=wallet.balance if wallet else 0,
                            label="Game Won",
                            game_title=table.config["name"],
                            note=f"Hit number {result}",
                        )
                        db.session.add(win_tx)

                    # Update forced winner history status to 'executed'
                    history_record = ForcedWinnerHistory.query.filter_by(
                        round_code=table.round_code,
                        status="active"
                    ).first()
                    if history_record:
                        history_record.status = "executed"
                        history_record.note = f"Executed. Winner: {result}"

                    db.session.commit()

                    # ✅ clear forced winner after round ends (one-round only)
                    forced_winners.pop((table.game_type, table.round_code), None)

                    time.sleep(3)

                    # Reset for new round (predictable)
                    table.bets = []
                    table.result = None
                    table.is_betting_closed = False
                    table.is_finished = False

                    base = floor_to_period(datetime.now(), ROUND_SECONDS)
                    # keep same staggering by table_number (1..6) => 0..5 minutes
                    table.start_time = base + timedelta(seconds=(table.table_number - 1) * 60)
                    table.end_time = table.start_time + timedelta(seconds=ROUND_SECONDS)
                    table.betting_close_time = table.end_time - timedelta(seconds=15)
                    table.round_code = make_round_code(table.game_type, table.start_time, table.table_number)

                    table.last_bot_added_at = None
                    print(
                        f"{table.game_type} Table {table.table_number}: New round started - {table.round_code}"
                    )

                time.sleep(1)

            except Exception as e:
                print(f"Error managing table {table.game_type} #{table.table_number}: {e}")
                time.sleep(1)


def start_all_game_tables():
    for _, tables in game_tables.items():
        for table in tables:
            threading.Thread(target=manage_game_table, args=(table,), daemon=True).start()
    print("All game table threads started!")


# ---------------------------------------------------
# Super Admin routes (login-based with history)
# ---------------------------------------------------

@app.route("/sa-login")
def sa_login_page():
    if "is_superadmin" in session and session.get("is_superadmin"):
        return redirect(url_for("super_admin_panel"))
    return render_template("sa-login.html")


@app.route("/sa-login", methods=["POST"])
def sa_login_post():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"}), 400

    if username == SUPERADMIN_USERNAME and password == SUPERADMIN_PASSWORD:
        session["is_superadmin"] = True
        session["superadmin_username"] = username
        session.permanent = True
        return jsonify({"success": True, "redirect": url_for("super_admin_panel")})
    
    return jsonify({"success": False, "message": "Invalid credentials"}), 401


@app.route("/sa-logout")
def sa_logout():
    session.pop("is_superadmin", None)
    session.pop("superadmin_username", None)
    return redirect(url_for("sa_login_page"))


@app.route("/sa")
@superadmin_required
def super_admin_panel():
    return render_template("super_admin.html", username=session.get("superadmin_username", "SuperAdmin"))


@app.route("/api/sa/rounds", methods=["GET"])
@superadmin_required
def sa_rounds():
    """Get rounds filtered by date and time slot, only those >60 min away"""
    date_str = request.args.get("date")  # Format: YYYY-MM-DD
    time_slot = request.args.get("time_slot")  # Format: "22-23" for 10 PM - 11 PM
    
    if not date_str or not time_slot:
        return jsonify({"error": "date and time_slot required"}), 400
    
    try:
        # Parse date and time slot
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        start_hour, end_hour = map(int, time_slot.split("-"))
        
        slot_start = datetime.combine(target_date, datetime.min.time()).replace(hour=start_hour)
        slot_end = datetime.combine(target_date, datetime.min.time()).replace(hour=end_hour)
        
    except (ValueError, AttributeError):
        return jsonify({"error": "Invalid date or time_slot format"}), 400
    
    now = datetime.now()
    cutoff_time = now + timedelta(minutes=60)  # Only show rounds >60 min away
    
    # Calculate all possible rounds in the time slot
    out = []
    
    for game_type in GAME_CONFIGS.keys():
        for table_number in range(1, 7):  # Tables 1-6
            # Calculate round start times for this table
            # Each table has a stagger: table N starts at (N-1) * 60 seconds offset
            table_offset = (table_number - 1) * 60
            
            # Start from the slot_start and generate rounds every 5 minutes (300 seconds)
            current_time = floor_to_period(slot_start, ROUND_SECONDS) + timedelta(seconds=table_offset)
            
            # Generate all rounds within this hour slot
            while current_time < slot_end:
                # Only include if >60 minutes away
                if current_time > cutoff_time:
                    minutes_until = int((current_time - now).total_seconds() / 60)
                    round_code = make_round_code(game_type, current_time, table_number)
                    
                    # Check if this round already exists with a forced winner
                    forced_number = forced_winners.get((game_type, round_code))
                    
                    out.append({
                        "game_type": game_type,
                        "game_name": GAME_CONFIGS[game_type]["name"],
                        "table_number": table_number,
                        "round_code": round_code,
                        "start_time": current_time.strftime("%Y-%m-%d %H:%M:%S"),
                        "minutes_until_start": minutes_until,
                        "forced_number": forced_number,
                        "can_force": True
                    })
                
                # Move to next round (5 minutes later)
                current_time += timedelta(seconds=ROUND_SECONDS)
    
    out.sort(key=lambda x: x["start_time"])
    return jsonify({"rounds": out, "total": len(out)})


@app.route("/api/sa/force-winner", methods=["POST"])
@superadmin_required
def sa_force_winner():
    """Force a winner for a specific round - works with future rounds too"""
    data = request.get_json() or {}
    round_code = data.get("round_code") or ""
    number = data.get("number", None)
    
    if not round_code:
        return jsonify({"success": False, "message": "round_code required"}), 400
    
    # Extract info from round_code (format: G_20260217_2200_1)
    try:
        parts = round_code.split("_")
        game_initial = parts[0]
        date_stamp = parts[1]  # YYYYMMDD
        time_stamp = parts[2]  # HHMM
        table_num = int(parts[3])
        
        # Map initial to game_type
        game_type_map = {
            "S": "silver",
            "G": "gold", 
            "D": "diamond",
            "P": "platinum",
            "R": "roulette"
        }
        game_type = game_type_map.get(game_initial)
        
        if not game_type:
            return jsonify({"success": False, "message": "Invalid round code format"}), 400
        
        # Parse the round start time
        round_start_str = f"{date_stamp}_{time_stamp}"
        round_start = datetime.strptime(round_start_str, "%Y%m%d_%H%M")
        
    except (IndexError, ValueError) as e:
        return jsonify({"success": False, "message": f"Invalid round code format: {str(e)}"}), 400
    
    now = datetime.now()
    minutes_until = (round_start - now).total_seconds() / 60
    
    # Enforce 60-minute rule
    if minutes_until < 60:
        return jsonify({
            "success": False, 
            "message": f"Time expired! You can only force winner >60 minutes before start. This round starts in {int(minutes_until)} minutes."
        }), 400
    
    # Clear forced winner
    if number is None or str(number).strip() == "":
        forced_winners.pop((game_type, round_code), None)
        
        # Update history status to 'cleared'
        history_record = ForcedWinnerHistory.query.filter_by(
            round_code=round_code, 
            status="active"
        ).first()
        if history_record:
            history_record.status = "cleared"
            history_record.note = f"Cleared at {now.strftime('%Y-%m-%d %H:%M:%S')}"
            db.session.commit()
        
        return jsonify({"success": True, "message": "Forced winner cleared"})
    
    # Set forced winner
    try:
        n = int(number)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid number"}), 400
    
    if game_type == "roulette":
        if n < 0 or n > 36:
            return jsonify({"success": False, "message": "Roulette number must be 0-36"}), 400
    else:
        if n < 0 or n > 9:
            return jsonify({"success": False, "message": "Number must be 0-9"}), 400
    
    forced_winners[(game_type, round_code)] = n
    
    # Save to history
    existing = ForcedWinnerHistory.query.filter_by(
        round_code=round_code,
        status="active"
    ).first()
    
    if existing:
        existing.forced_number = n
        existing.forced_at = now
        existing.note = f"Updated at {now.strftime('%Y-%m-%d %H:%M:%S')}"
    else:
        history_record = ForcedWinnerHistory(
            round_code=round_code,
            game_type=game_type,
            game_name=GAME_CONFIGS[game_type]["name"],
            table_number=table_num,
            forced_number=n,
            round_start_time=round_start,
            forced_by=session.get("superadmin_username", "unknown"),
            status="active",
            note=f"Forced {int(minutes_until)} minutes before start"
        )
        db.session.add(history_record)
    
    db.session.commit()
    
    return jsonify({
        "success": True, 
        "message": f"Forced winner set to {n} for {round_code}",
        "round_code": round_code,
        "number": n
    })


@app.route("/api/sa/history", methods=["GET"])
@superadmin_required
def sa_history():
    """Get history of all forced winners"""
    limit = request.args.get("limit", 100, type=int)
    
    history = (
        ForcedWinnerHistory.query
        .order_by(ForcedWinnerHistory.forced_at.desc())
        .limit(limit)
        .all()
    )
    
    out = []
    for h in history:
        out.append({
            "id": h.id,
            "round_code": h.round_code,
            "game_name": h.game_name,
            "table_number": h.table_number,
            "forced_number": h.forced_number,
            "round_start_time": h.round_start_time.strftime("%Y-%m-%d %H:%M:%S"),
            "forced_at": h.forced_at.strftime("%Y-%m-%d %H:%M:%S"),
            "forced_by": h.forced_by,
            "status": h.status,
            "note": h.note or ""
        })
    
    return jsonify({"history": out, "total": len(out)})

# ---------------------------------------------------
# Socket.IO events
# ---------------------------------------------------

@socketio.on("connect")
def handle_connect():
    print(f"Client connected: {request.sid}")


@socketio.on("disconnect")
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")


@socketio.on("join_game")
def handle_join_game(data):
    game_type = data.get("game_type")
    if game_type in GAME_CONFIGS:
        join_room(game_type)
        print(f"Client {request.sid} joined room: {game_type}")
        emit("joined", {"game_type": game_type, "message": f"Joined {game_type} game"})


@socketio.on("place_bet")
def handle_place_bet(data):
    """✅ FIXED: Handle user bet placement - forced winners NEVER block bets"""
    game_type = data.get("game_type")
    raw_user_id = data.get("user_id")
    username = data.get("username")
    number = data.get("number")
    round_code = data.get("round_code")

    print(f"🎯 Bet attempt: user={raw_user_id}, game={game_type}, number={number}, round={round_code}")
    
    # ✅ Check if this round has a forced winner (for logging only)
    forced = forced_winners.get((game_type, round_code))
    if forced is not None:
        print(f"⚠️  This round has forced winner: {forced} (should NOT block betting)")

    if game_type not in GAME_CONFIGS:
        print(f"❌ Invalid game type: {game_type}")
        emit("bet_error", {"message": "Invalid game type"})
        return

    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError):
        user_id = raw_user_id

    user = User.query.get(user_id)
    if not user:
        print(f"❌ User not found: {user_id}")
        emit("bet_error", {"message": "User not found"})
        return

    if user.is_blocked:
        emit("bet_error", {"message": f"Your account is blocked. Reason: {user.block_reason or 'No reason provided'}"})
        return

    wallet = ensure_wallet_for_user(user)
    if not wallet:
        emit("bet_error", {"message": "Admin cannot place bets"})
        return

    tables = game_tables.get(game_type)
    if not tables:
        print(f"❌ No tables for game: {game_type}")
        emit("bet_error", {"message": "No tables for this game"})
        return

    table = None
    if round_code:
        for t in tables:
            if t.round_code == round_code:
                table = t
                break
        if not table:
            print(f"❌ Round not found: {round_code}")
            print(f"Available rounds: {[t.round_code for t in tables]}")
            emit("bet_error", {"message": "This game round is no longer available. Please join a new game."})
            return
    else:
        for t in tables:
            if (not t.is_betting_closed) and (not t.is_finished) and (len(t.bets) < t.max_players):
                table = t
                break
        if not table:
            print(f"❌ No open table found")
            emit("bet_error", {"message": "No open game table"})
            return

    print(f"📋 Table found: {table.round_code}, players: {len(table.bets)}/{table.max_players}, closed: {table.is_betting_closed}, finished: {table.is_finished}")
    print(f"📋 Current bets in table: {[(b['username'], b['number']) for b in table.bets]}")

    if table.is_finished or table.is_betting_closed:
        print(f"❌ Betting closed for: {table.round_code}")
        emit("bet_error", {"message": "Betting is closed for this game"})
        return

    if len(table.bets) >= table.max_players:
        print(f"❌ Table full: {table.round_code}")
        emit("bet_error", {"message": "All slots are full"})
        return

    bet_amount = table.config["bet_amount"]
    if wallet.balance < bet_amount:
        print(f"❌ Insufficient balance: {wallet.balance} < {bet_amount}")
        emit("bet_error", {"message": "Insufficient balance"})
        return

    # ✅ CRITICAL: Add bet to table (forced winner does NOT interfere with betting)
    print(f"🔄 Attempting to add bet: number={number}, user={username}")
    success, message = table.add_bet(user_id, username, number)
    
    if not success:
        print(f"❌ Bet rejected by table.add_bet(): {message}")
        print(f"   Taken numbers: {[b['number'] for b in table.bets]}")
        print(f"   User trying: {number}")
        emit("bet_error", {"message": message})
        return

    # Deduct balance
    wallet.balance -= bet_amount

    # Log transaction
    bet_tx = Transaction(
        user_id=user_id,
        kind="bet",
        amount=bet_amount,
        balance_after=wallet.balance,
        label="Bet Placed",
        game_title=table.config["name"],
        note=f"Number {number}, Round {table.round_code}",
    )
    db.session.add(bet_tx)
    db.session.commit()

    print(f"✅ Bet SUCCESS: user={user_id}, number={number}, round={table.round_code}, balance={wallet.balance}")
    print(f"✅ Table now has {len(table.bets)} bets: {[(b['username'], b['number']) for b in table.bets]}")

    # Prepare players list for broadcast
    players_data = []
    for bet in table.bets:
        players_data.append(
            {
                "user_id": str(bet["user_id"]), 
                "username": bet["username"], 
                "number": bet["number"]
            }
        )

    print(f"📢 Emitting bet_success with {len(players_data)} players")

    # Emit success to the user
    emit(
        "bet_success",
        {
            "message": message,
            "new_balance": wallet.balance,
            "round_code": table.round_code,
            "table_number": table.table_number,
            "players": players_data,
            "slots_available": table.get_slots_available(),
        },
    )

    # ✅ Broadcast table update to ALL clients in this game room
    emit(
        "update_table",
        {
            "game_type": game_type,
            "table_number": table.table_number,
            "round_code": table.round_code,
            "players": players_data,
            "slots_available": table.get_slots_available(),
            "time_remaining": table.get_time_remaining(),
            "is_betting_closed": table.is_betting_closed,
        },
        room=game_type,
        broadcast=True,
        include_self=True,
    )

    print(f"✅ Broadcast complete for round {table.round_code}\n")


# ---------------------------------------------------
# API: tables and history
# ---------------------------------------------------

@app.route("/api/tables/<game_type>")
def get_game_tables_api(game_type):
    try:
        game_type = game_type.lower()
        if game_type not in GAME_CONFIGS:
            return jsonify({"error": "Invalid game type", "tables": []}), 404

        tables_list = game_tables.get(game_type, [])
        if not tables_list:
            return jsonify({"game_type": game_type, "tables": [], "message": "No tables initialized"}), 200

        serialized_tables = []
        for table in tables_list:
            if table:
                bets_list = []
                if table.bets:
                    for bet in table.bets:
                        bets_list.append(
                            {
                                "user_id": str(bet.get("user_id", "")),
                                "username": bet.get("username", "Unknown"),
                                "number": bet.get("number", 0),
                            }
                        )

                serialized_tables.append(
                    {
                        "table_number": table.table_number,
                        "game_type": table.game_type,
                        "round_code": table.round_code,
                        "players": len(bets_list),
                        "bets": bets_list,
                        "result": table.result,
                        "max_players": table.max_players,
                        "slots_available": table.get_slots_available(),
                        "time_remaining": table.get_time_remaining(),
                        "is_betting_closed": table.is_betting_closed,
                        "is_finished": table.is_finished,
                        "is_started": table.is_started(),
                        "min_bet": table.config.get("bet_amount", 0),
                        "max_bet": table.config.get("payout", 0),
                        "status": "betting_closed" if table.is_betting_closed else "active",
                    }
                )

        return jsonify({"game_type": game_type, "tables": serialized_tables, "total_tables": len(serialized_tables)}), 200

    except Exception as e:
        print(f"Error in get_game_tables_api: {str(e)}")
        return jsonify({"error": str(e), "game_type": game_type, "tables": []}), 500


@app.route("/api/tables")
def get_all_tables():
    all_tables = {
        game_type: [table.to_dict() for table in tables]
        for game_type, tables in game_tables.items()
    }
    return jsonify(all_tables)


@app.route("/api/user-games")
def user_games_history_api():
    user_id = request.args.get("user_id", type=int)
    if not user_id:
        return jsonify({"current_games": [], "game_history": []})

    user_bets = user_game_history.get(user_id, [])

    grouped = {}
    for b in user_bets:
        key = (b["game_type"], b["round_code"])
        if key not in grouped:
            grouped[key] = {
                "game_type": b["game_type"],
                "round_code": b["round_code"],
                "bet_amount": GAME_CONFIGS[b["game_type"]]["bet_amount"],
                "user_bets": [],
                "winning_number": None,
                "date_time": "",
                "status": None,
                "amount": 0,
                "time_remaining": None,
                "table_number": b.get("table_number"),
            }
        grouped[key]["user_bets"].append(b["number"])
        if b.get("winning_number") is not None:
            grouped[key]["winning_number"] = b["winning_number"]
            grouped[key]["status"] = b["status"]
            if b["status"] == "win":
                grouped[key]["amount"] += GAME_CONFIGS[b["game_type"]]["payout"]
            else:
                grouped[key]["amount"] -= GAME_CONFIGS[b["game_type"]]["bet_amount"]
        if b.get("date_time"):
            grouped[key]["date_time"] = b["date_time"]

    all_games = list(grouped.values())

    for g in all_games:
        if not g.get("status"):
            tables = game_tables.get(g["game_type"], [])
            for table in tables:
                if table.round_code == g["round_code"]:
                    g["time_remaining"] = table.get_time_remaining()
                    break

    game_history = [g for g in all_games if g.get("status")]
    current_games = [g for g in all_games if not g.get("status")]

    return jsonify({"current_games": current_games, "game_history": game_history})


# ---------------------------------------------------
# Auth routes
# ---------------------------------------------------


@app.route("/")
def index():
    if "user_id" in session:
        user = User.query.get(session.get("user_id"))
        if user and user.is_admin:
            return redirect(url_for("admin_panel"))
        return redirect(url_for("home"))
    return redirect(url_for("login_page"))


@app.route("/login")
def login_page():
    if "user_id" in session:
        user = User.query.get(session.get("user_id"))
        if user and user.is_admin:
            return redirect(url_for("admin_panel"))
        return redirect(url_for("home"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login_post():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    remember_me = data.get("remember_me", False)

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({"success": False, "message": "Invalid username or password"}), 401

    if user.is_blocked:
        return jsonify({"success": False, "message": f"Your account is blocked. Reason: {user.block_reason or 'No reason provided'}"}), 403

    if not user.is_admin:
        ensure_wallet_for_user(user)

    session["user_id"] = user.id
    session["userid"] = user.id
    session["username"] = user.username
    if remember_me:
        session.permanent = True

    token = secrets.token_urlsafe(32)
    redirect_url = url_for("admin_panel") if user.is_admin else url_for("home")

    return jsonify({"success": True, "user_id": user.id, "username": user.username, "token": token, "redirect": redirect_url})


@app.route("/register", methods=["GET", "POST"])
def register_page():
    if request.method == "GET":
        if "user_id" in session:
            return redirect(url_for("home"))
        return render_template("register.html")

    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"success": False, "message": "Username and password required"}), 400
    if len(password) < 6:
        return jsonify({"success": False, "message": "Password must be at least 6 characters"}), 400

    existing = User.query.filter_by(username=username).first()
    if existing:
        return jsonify({"success": False, "message": "Username already exists"}), 400

    user = User(username=username, display_name=username)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    ensure_wallet_for_user(user)

    session["user_id"] = user.id
    session["userid"] = user.id
    session["username"] = user.username

    token = secrets.token_urlsafe(32)
    return jsonify({"success": True, "user_id": user.id, "username": user.username, "token": token, "redirect": url_for("home")})


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


# ---------------------------------------------------
# User pages
# ---------------------------------------------------

@app.route("/home")
@login_required
def home():
    user = User.query.get(session.get("user_id"))
    if user.is_admin:
        return redirect(url_for("admin_panel"))
    wallet = ensure_wallet_for_user(user)
    return render_template("home.html", user=user, balance=wallet.balance if wallet else 0)


@app.route("/profile")
@login_required
def profile_page():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    return render_template("profile.html", user=user, balance=wallet.balance if wallet else 0)


@app.route("/profile", methods=["POST"])
@login_required
def profile_update():
    user = User.query.get(session.get("user_id"))
    data = request.get_json() or {}

    user.display_name = data.get("display_name", user.display_name)
    user.email = data.get("email", user.email)
    user.country = data.get("country", user.country)
    user.phone = data.get("phone", user.phone)

    db.session.commit()
    return jsonify({"success": True, "message": "Profile updated"})


@app.route("/wallet")
@login_required
def wallet_page():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    transactions = Transaction.query.filter_by(user_id=user.id).order_by(Transaction.datetime.desc()).limit(50).all()
    
    tx_list = []
    for tx in transactions:
        tx_list.append({
            "kind": tx.kind,
            "amount": tx.amount,
            "balance_after": tx.balance_after,
            "label": tx.label,
            "game_title": tx.game_title,
            "note": tx.note,
            "datetime": tx.datetime.strftime("%Y-%m-%d %H:%M")
        })
    
    return render_template("wallet.html", user=user, balance=wallet.balance if wallet else 0, transactions=tx_list)


@app.route("/history")
@login_required
def history_page():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    return render_template("history.html", user=user, balance=wallet.balance if wallet else 0)


@app.route("/support")
@login_required
def support_page():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    tickets = Ticket.query.filter_by(user_id=user.id).order_by(Ticket.created_at.desc()).all()
    return render_template("support.html", user=user, balance=wallet.balance if wallet else 0, tickets=tickets)


@app.route("/support", methods=["POST"])
@login_required
def support_submit():
    user = User.query.get(session.get("user_id"))
    data = request.get_json() or {}
    
    subject = data.get("subject", "").strip()
    message = data.get("message", "").strip()
    
    if not subject or not message:
        return jsonify({"success": False, "message": "Subject and message required"}), 400
    
    ticket = Ticket(user_id=user.id, subject=subject, message=message)
    db.session.add(ticket)
    db.session.commit()
    
    return jsonify({"success": True, "message": "Ticket submitted", "ticket_id": ticket.id})


# ---------------------------------------------------
# Game pages
# ---------------------------------------------------

@app.route("/game/silver")
@login_required
def silver_game():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    return render_template("silver-game.html", user=user, balance=wallet.balance if wallet else 0)


@app.route("/game/gold")
@login_required
def gold_game():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    return render_template("gold-game.html", user=user, balance=wallet.balance if wallet else 0)


@app.route("/game/diamond")
@login_required
def diamond_game():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    return render_template("diamond-game.html", user=user, balance=wallet.balance if wallet else 0)


@app.route("/game/platinum")
@login_required
def platinum_game():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    return render_template("platinum-game.html", user=user, balance=wallet.balance if wallet else 0)


@app.route("/game/roulette")
@login_required
def roulette_game():
    user = User.query.get(session.get("user_id"))
    wallet = ensure_wallet_for_user(user)
    return render_template("roulette-game.html", user=user, balance=wallet.balance if wallet else 0)


# ---------------------------------------------------
# Admin routes
# ---------------------------------------------------

@app.route("/admin")
@admin_required
def admin_panel():
    return render_template("admin.html")


@app.route("/api/admin/users")
@admin_required
def admin_users():
    users = User.query.filter_by(is_admin=False).all()
    users_list = []
    for u in users:
        wallet = Wallet.query.filter_by(user_id=u.id).first()
        users_list.append({
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "email": u.email,
            "balance": wallet.balance if wallet else 0,
            "is_blocked": u.is_blocked,
            "block_reason": u.block_reason,
            "created_at": u.created_at.strftime("%Y-%m-%d")
        })
    return jsonify({"users": users_list})


@app.route("/api/admin/add-balance", methods=["POST"])
@admin_required
def admin_add_balance():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    amount = data.get("amount", 0)
    
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid amount"}), 400
    
    if amount <= 0:
        return jsonify({"success": False, "message": "Amount must be positive"}), 400
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    
    wallet = ensure_wallet_for_user(user)
    if not wallet:
        return jsonify({"success": False, "message": "Cannot add balance to admin"}), 400
    
    wallet.balance += amount
    
    tx = Transaction(
        user_id=user.id,
        kind="added",
        amount=amount,
        balance_after=wallet.balance,
        label="Balance Added by Admin",
        note=f"Added by admin"
    )
    db.session.add(tx)
    db.session.commit()
    
    return jsonify({"success": True, "message": f"Added {amount} coins", "new_balance": wallet.balance})


@app.route("/api/admin/block-user", methods=["POST"])
@admin_required
def admin_block_user():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    reason = data.get("reason", "No reason provided")
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    
    user.is_blocked = True
    user.block_reason = reason
    db.session.commit()
    
    return jsonify({"success": True, "message": "User blocked"})


@app.route("/api/admin/unblock-user", methods=["POST"])
@admin_required
def admin_unblock_user():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404
    
    user.is_blocked = False
    user.block_reason = None
    db.session.commit()
    
    return jsonify({"success": True, "message": "User unblocked"})


@app.route("/api/admin/tickets")
@admin_required
def admin_tickets():
    tickets = Ticket.query.order_by(Ticket.created_at.desc()).all()
    tickets_list = []
    for t in tickets:
        tickets_list.append({
            "id": t.id,
            "user_id": t.user_id,
            "username": t.user.username,
            "subject": t.subject,
            "message": t.message,
            "status": t.status,
            "created_at": t.created_at.strftime("%Y-%m-%d %H:%M")
        })
    return jsonify({"tickets": tickets_list})


@app.route("/api/admin/ticket/<int:ticket_id>/close", methods=["POST"])
@admin_required
def admin_close_ticket(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"success": False, "message": "Ticket not found"}), 404
    
    ticket.status = "closed"
    db.session.commit()
    
    return jsonify({"success": True, "message": "Ticket closed"})


# ---------------------------------------------------
# Initialization
# ---------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        print("✅ Database initialized")
        
        # Create admin if doesn't exist
        admin = User.query.filter_by(username="admin").first()
        if not admin:
            admin = User(username="admin", display_name="Admin", is_admin=True)
            admin.set_password("admin123")
            db.session.add(admin)
            db.session.commit()
            print("✅ Admin user created (username: admin, password: admin123)")
        
        initialize_game_tables()
        start_all_game_tables()
        
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)
