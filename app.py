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
from datetime import datetime, timedelta, timezone
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
APP_TIMEZONE = "UTC"

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
    # Treat naive datetimes as UTC to avoid server-local timezone drift.
    if dt.tzinfo is None:
        ts = int(dt.replace(tzinfo=timezone.utc).timestamp())
    else:
        ts = int(dt.timestamp())
    floored = _floor_epoch(ts, period_seconds)
    return datetime.utcfromtimestamp(floored)

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
        base = floor_to_period(datetime.utcnow(), ROUND_SECONDS)
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
            "bet_time": datetime.utcnow(),
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
                    "bet_time": datetime.utcnow(),
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
                    {"user_id": bet["user_id"], "username": bet["username"], "payout": self.config["payout"]}
                )
        return winners

    def get_time_remaining(self):
        now = datetime.utcnow()
        if now < self.start_time:
            return int((self.end_time - self.start_time).total_seconds())
        if now >= self.end_time:
            return 0
        return int((self.end_time - now).total_seconds())


    def get_slots_available(self):
        return self.max_players - len(self.bets)

    def is_started(self):
        return datetime.utcnow() >= self.start_time

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
                now = datetime.utcnow()

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
                    # if a forced winner exists, only use it if bet exists
                    forced = forced_winners.get((table.game_type, table.round_code))
                    if forced is not None:
                        bet_numbers = {b.get("number") for b in (table.bets or [])}
                        table.result = forced if forced in bet_numbers else table.calculate_result()
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

                    base = floor_to_period(datetime.utcnow(), ROUND_SECONDS)
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
    
        now = datetime.utcnow()
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
    
    now = datetime.utcnow()
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
    session["userid"] = user.id  # alias for older templates/JS
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

    return jsonify({"success": True, "user_id": user.id, "username": user.username, "redirect": url_for("home")})


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login_page"))


# ---------------------------------------------------
# Game pages
# ---------------------------------------------------


@app.route("/home")
@login_required
def home():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if user:
        ensure_wallet_for_user(user)
    username = session.get("username", "Player")
    return render_template("home.html", games=GAME_CONFIGS, username=username)


@app.route("/game/<game_type>")
@login_required
def game_lobby(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template("game-lobby.html", game_type=game_type, game=game)


@app.route("/play/<game_type>")
@login_required
def play_game(game_type):
    if game_type not in GAME_CONFIGS:
        return "Game not found", 404
    game = GAME_CONFIGS[game_type]
    return render_template(f"{game_type}-game.html", game_type=game_type, game=game)


@app.route("/history")
@login_required
def history_page():
    return render_template("history.html")


@app.route("/profile")
@login_required
def profile_page():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return redirect(url_for("logout"))

    wallet = ensure_wallet_for_user(user)
    wallet_balance = wallet.balance if wallet else 0
    joined_at = user.created_at.strftime("%d %b %Y") if user.created_at else "Just now"

    transactions = (
        Transaction.query.filter_by(user_id=user_id)
        .order_by(Transaction.datetime.desc())
        .limit(50)
        .all()
    )

    txns = []
    for t in transactions:
        txns.append(
            {
                "kind": t.kind,
                "amount": t.amount,
                "datetime": t.datetime.isoformat(),
                "label": t.label or t.kind.title(),
                "game_title": t.game_title or "",
                "note": t.note or "",
                "balance_after": t.balance_after,
            }
        )

    return render_template(
        "profile.html",
        username=user.username,
        display_name=user.display_name or user.username,
        joined_at=joined_at,
        wallet_balance=wallet_balance,
        email=user.email or "",
        country=user.country or "",
        phone=user.phone or "",
        transactions=txns,
    )


@app.route("/profile/update", methods=["POST"])
@login_required
def profile_update():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    user.display_name = data.get("displayName", user.display_name or user.username)
    user.email = data.get("email", user.email or "")
    user.country = data.get("country", user.country or "")
    user.phone = data.get("phone", user.phone or "")

    db.session.commit()
    return jsonify({"success": True, "message": "Profile updated"})


@app.route("/help")
@login_required
def help_page():
    return render_template("help.html")


@app.route("/coins", methods=["GET"])
@login_required
def coins_page():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return redirect(url_for("logout"))

    wallet = ensure_wallet_for_user(user)
    balance = wallet.balance if wallet else 0
    return render_template("coins.html", balance=balance)


@app.route("/api/balance", methods=["GET"])
@login_required
def get_balance_api():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return jsonify({"balance": 0}), 401

    wallet = ensure_wallet_for_user(user)
    balance = wallet.balance if wallet else 0
    return jsonify({"balance": balance})


@app.route("/api/coins/redeem", methods=["POST"])
@login_required
def redeem_coins():
    user_id = session.get("user_id")
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 401

    data = request.get_json() or {}
    try:
        amount = int(data.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid amount"}), 400

    if amount <= 0:
        return jsonify({"success": False, "message": "Amount must be greater than 0"}), 400

    wallet = ensure_wallet_for_user(user)
    if not wallet or wallet.balance < amount:
        return jsonify({"success": False, "message": "Insufficient balance"}), 400

    wallet.balance -= amount
    db.session.commit()

    return jsonify({"success": True, "message": f"Successfully redeemed {amount} coins!", "new_balance": wallet.balance})


@app.route("/api/help/tickets", methods=["GET", "POST"])
@login_required
def help_tickets_api():
    user_id = session.get("user_id")

    if request.method == "GET":
        tickets = (
            Ticket.query.filter_by(user_id=user_id)
            .order_by(Ticket.created_at.desc())
            .all()
        )
        out = []
        for t in tickets:
            out.append(
                {
                    "id": t.id,
                    "subject": t.subject,
                    "message": t.message[:200],
                    "status": t.status,
                    "created_at": t.created_at.strftime("%Y-%m-%d %H:%M"),
                    "updated_at": t.updated_at.strftime("%Y-%m-%d %H:%M"),
                }
            )
        return jsonify(out)

    subject = request.form.get("subject", "").strip() or "(no subject)"
    message = request.form.get("message", "").strip()
    file = request.files.get("attachment")

    attach_name = None
    if file and file.filename:
        upload_dir = os.path.join(os.path.dirname(__file__), "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        attach_name = f"{int(time.time())}_{file.filename}"
        file.save(os.path.join(upload_dir, attach_name))

    ticket = Ticket(user_id=user_id, subject=subject, message=message, attachment_name=attach_name)
    db.session.add(ticket)
    db.session.commit()

    return jsonify({"success": True, "ticket_id": ticket.id})


@app.route("/balance/<user_id>")
def get_balance(user_id):
    real_user_id = session.get("user_id")
    if not real_user_id:
        return jsonify({"balance": 0})

    user = User.query.get(real_user_id)
    if not user:
        return jsonify({"balance": 0})

    wallet = ensure_wallet_for_user(user)
    return jsonify({"balance": wallet.balance if wallet else 0})


# ---------------------------------------------------
# ADMIN PANEL ROUTES
# ---------------------------------------------------


@app.route("/admin")
@admin_required
def admin_panel():
    return render_template("admin_panel.html")


@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_get_users():
    users = User.query.filter(User.is_admin == False).all()
    user_list = []

    for user in users:
        wallet = ensure_wallet_for_user(user)
        user_list.append(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email or "",
                "password_hash": user.password_hash,
                "status": "blocked" if user.is_blocked else "active",
                "balance": wallet.balance if wallet else 0,
                "created_at": user.created_at.strftime("%Y-%m-%d %H:%M"),
                "block_reason": user.block_reason or "",
            }
        )

    return jsonify(user_list)


@app.route("/api/admin/users/<int:user_id>", methods=["PUT"])
@admin_required
def admin_update_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}

    if "username" in data:
        user.username = data["username"]
    if "email" in data:
        user.email = data["email"]
    if "password" in data and data["password"]:
        user.set_password(data["password"])
    if "status" in data:
        user.is_blocked = data["status"] == "blocked"
    if "balance" in data:
        wallet = ensure_wallet_for_user(user)
        if wallet:
            wallet.balance = data["balance"]
    if "block_reason" in data:
        user.block_reason = data["block_reason"]

    db.session.commit()
    return jsonify({"success": True, "message": "User updated successfully"})


@app.route("/api/admin/users/<int:user_id>/block", methods=["POST"])
@admin_required
def admin_block_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    user.is_blocked = True
    user.block_reason = data.get("reason", "Blocked by admin")

    db.session.commit()
    return jsonify({"success": True, "message": "User blocked successfully"})


@app.route("/api/admin/users/<int:user_id>/unblock", methods=["POST"])
@admin_required
def admin_unblock_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    user.is_blocked = False
    user.block_reason = None

    db.session.commit()
    return jsonify({"success": True, "message": "User unblocked successfully"})


@app.route("/api/admin/users/<int:user_id>/balance", methods=["POST"])
@admin_required
def admin_credit_debit(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    transaction_type = data.get("type", "add")
    amount = float(data.get("amount", 0))
    reason = data.get("reason", "Admin transaction")

    wallet = ensure_wallet_for_user(user)
    if wallet:
        if transaction_type == "add":
            wallet.balance += amount
        else:
            wallet.balance -= amount

    db.session.commit()

    return jsonify(
        {
            "success": True,
            "message": f"Transaction processed. New balance: ₹{wallet.balance if wallet else 0}",
            "new_balance": wallet.balance if wallet else 0,
            "reason": reason,
        }
    )


@app.route("/api/admin/games", methods=["GET"])
@admin_required
def admin_get_games():
    all_games = []
    for game_type, tables in game_tables.items():
        for table in tables:
            all_games.append(
                {
                    "round_code": table.round_code,
                    "game_type": game_type,
                    "players": len(table.bets),
                    "max_players": table.max_players,
                    "status": "finished"
                    if table.is_finished
                    else "completed"
                    if table.is_betting_closed
                    else "active",
                    "result": table.result,
                    "total_bets": sum(b.get("bet_amount", 0) for b in table.bets),
                    "started_at": table.start_time.strftime("%Y-%m-%d %H:%M"),
                }
            )
    return jsonify(all_games)


@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_get_stats():
    total_users = User.query.filter(User.is_admin == False).count()
    blocked_users = User.query.filter(User.is_admin == False, User.is_blocked == True).count()

    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    active_users = 0
    for user in User.query.filter(User.is_admin == False).all():
        wallet = ensure_wallet_for_user(user)
        if wallet and wallet.balance > 0:
            recent_games = [
                g
                for g in user_game_history.get(user.id, [])
                if g.get("bet_time")
                and isinstance(g["bet_time"], datetime)
                and g["bet_time"] > thirty_days_ago
            ]
            if recent_games:
                active_users += 1

    inactive_users = total_users - active_users

    total_revenue = sum(w.balance for w in Wallet.query.all())
    total_deposit = total_revenue
    total_withdrawal = 0

    active_games = sum(1 for tables in game_tables.values() for t in tables if not t.is_finished)
    open_tickets = Ticket.query.filter_by(status="open").count()

    return jsonify(
        {
            "total_users": total_users,
            "active_users": active_users,
            "inactive_users": inactive_users,
            "active_games": active_games,
            "total_revenue": total_revenue,
            "total_deposit": total_deposit,
            "total_withdrawal": total_withdrawal,
            "blocked_users": blocked_users,
            "open_tickets": open_tickets,
        }
    )


@app.route("/api/admin/users/<int:user_id>/games", methods=["GET"])
@admin_required
def admin_user_games(user_id):
    bets = user_game_history.get(user_id, [])
    out = []
    for b in bets:
        cfg = GAME_CONFIGS.get(b["game_type"], {})
        out.append(
            {
                "game_type": b["game_type"],
                "round_code": b["round_code"],
                "bet_amount": b.get("bet_amount", cfg.get("bet_amount", 0)),
                "number": b.get("number"),
                "table_number": b.get("table_number"),
                "is_resolved": b.get("is_resolved", False),
                "status": b.get("status"),
                "winning_number": b.get("winning_number"),
                "amount": b.get("amount", 0),
                "date_time": b.get("date_time")
                or (
                    b.get("bet_time").strftime("%Y-%m-%d %H:%M")
                    if isinstance(b.get("bet_time"), datetime)
                    else ""
                ),
            }
        )
    return jsonify(out)


@app.route("/api/admin/agents", methods=["GET"])
@admin_required
def admin_get_agents():
    return jsonify([])


@app.route("/api/admin/wallet", methods=["GET"])
@admin_required
def admin_get_wallet_stats():
    total_balance = db.session.query(db.func.sum(Wallet.balance)).scalar() or 0
    wallet_count = Wallet.query.count()
    return jsonify({"total_balance": total_balance, "wallet_count": wallet_count, "wallets": []})


@app.route("/api/admin/referrals", methods=["GET"])
@admin_required
def admin_get_referrals():
    return jsonify([])


@app.route("/api/admin/promos", methods=["GET", "POST"])
@admin_required
def admin_promos():
    if request.method == "GET":
        return jsonify([])
    data = request.get_json() or {}
    return jsonify({"success": True, "message": "Promo saved (placeholder)", "data": data})


@app.route("/api/admin/announcements", methods=["GET", "POST"])
@admin_required
def admin_announcements():
    if request.method == "GET":
        return jsonify([])
    data = request.get_json() or {}
    return jsonify({"success": True, "message": "Announcement saved (placeholder)", "data": data})


@app.route("/api/admin/reports", methods=["GET"])
@admin_required
def admin_reports():
    total_users = User.query.filter(User.is_admin == False).count()
    total_wallets = Wallet.query.count()
    total_balance = db.session.query(db.func.sum(Wallet.balance)).scalar() or 0
    return jsonify({"total_users": total_users, "total_wallets": total_wallets, "total_balance": total_balance, "top_games": [], "top_users": []})


@app.route("/api/admin/transactions", methods=["GET"])
@admin_required
def admin_get_transactions():
    out = []
    for user_id, bets in user_game_history.items():
        user = User.query.get(user_id)
        username = user.username if user else f"user_{user_id}"

        for rec in bets:
            cfg = GAME_CONFIGS.get(rec["game_type"], {})
            game_title = cfg.get("name", rec["game_type"])
            bet_amt = rec.get("bet_amount", cfg.get("bet_amount", 0))
            dt = rec.get("bet_time", datetime.utcnow())
            dt_str = dt.strftime("%Y-%m-%d %H:%M") if isinstance(dt, datetime) else str(dt)

            out.append(
                {
                    "user_id": user_id,
                    "username": username,
                    "type": "bet",
                    "game_type": rec["game_type"],
                    "game_title": game_title,
                    "round_code": rec["round_code"],
                    "amount": bet_amt,
                    "status": rec.get("status") or "pending",
                    "datetime": dt_str,
                }
            )

            if rec.get("is_resolved") and rec.get("win"):
                win_dt = rec.get("date_time") or dt_str
                out.append(
                    {
                        "user_id": user_id,
                        "username": username,
                        "type": "win",
                        "game_type": rec["game_type"],
                        "game_title": game_title,
                        "round_code": rec["round_code"],
                        "amount": cfg.get("payout", 0),
                        "status": "win",
                        "datetime": win_dt,
                    }
                )

    return jsonify(out)


# ---------------------------------------------------
# Socket.IO handlers
# ---------------------------------------------------


@socketio.on("connect")
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit("connection_response", {"data": "Connected"})


@socketio.on("disconnect")
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")


@socketio.on("join_game")
def handle_join_game(data):
    game_type = data.get("game_type")
    user_id = data.get("user_id")
    print(f"User {user_id} joined game {game_type}")
    join_room(game_type)


@socketio.on("place_bet")
def handle_place_bet(data):
    """Handle user bet placement - FORCED WINNERS DON'T BLOCK USER BETS"""
    game_type = data.get("game_type")
    raw_user_id = data.get("user_id")
    username = data.get("username")
    number = data.get("number")
    round_code = data.get("round_code")

    print(f"🎯 Bet attempt: user={raw_user_id}, game={game_type}, number={number}, round={round_code}")

    if game_type not in GAME_CONFIGS:
        emit("bet_error", {"message": "Invalid game type"})
        return

    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError):
        user_id = raw_user_id

    user = User.query.get(user_id)
    if not user:
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
        emit("bet_error", {"message": "No tables for this game"})
        return

    table = None
    if round_code:
        for t in tables:
            if t.round_code == round_code:
                table = t
                break
        if not table:
            emit("bet_error", {"message": "This game round is no longer available. Please join a new game."})
            return
    else:
        for t in tables:
            if (not t.is_betting_closed) and (not t.is_finished) and (len(t.bets) < t.max_players):
                table = t
                break
        if not table:
            emit("bet_error", {"message": "No open game table"})
            return

    if table.is_finished or table.is_betting_closed:
        emit("bet_error", {"message": "Betting is closed for this game"})
        return

    if len(table.bets) >= table.max_players:
        emit("bet_error", {"message": "All slots are full"})
        return

    bet_amount = table.config["bet_amount"]
    if wallet.balance < bet_amount:
        emit("bet_error", {"message": "Insufficient balance"})
        return

    # ✅ CRITICAL: Add bet to table (forced winners don't interfere here)
    success, message = table.add_bet(user_id, username, number)
    if not success:
        print(f"❌ Bet rejected: {message}")
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
        note=f"Number {number}",
    )
    db.session.add(bet_tx)
    db.session.commit()

    print(f"✅ Bet placed successfully: user={user_id}, number={number}, round={table.round_code}")

    # Prepare players list for broadcast
    players_data = []
    for bet in table.bets:
        players_data.append(
            {"user_id": str(bet["user_id"]), "username": bet["username"], "number": bet["number"]}
        )

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

    # Broadcast table update to all clients
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
        broadcast=True,
        include_self=True,
    )


# ---------------------------------------------------
# Demo user seeding
# ---------------------------------------------------


def seed_demo_users():
    print("\n🔄 Checking/Creating users...")

    demo_usernames = ["demo"] + [f"demo{i}" for i in range(1, 6)]
    for uname in demo_usernames:
        user = User.query.filter_by(username=uname).first()
        if not user:
            user = User(username=uname, display_name=uname)
            user.set_password("demo123")
            db.session.add(user)
            db.session.commit()
            print(f"✅ Created user: {uname}")
        ensure_wallet_for_user(user)

    admin = User.query.filter_by(username="admin").first()
    if not admin:
        print("✅ Creating admin user...")
        admin = User(username="admin", display_name="Admin User", is_admin=True)
        admin.set_password("admin123")
        db.session.add(admin)
        db.session.commit()
        print("✅ Admin user created: is_admin=True (NO WALLET)")
    else:
        if not admin.is_admin:
            print("⚠️  Fixing admin user: setting is_admin=True")
            admin.is_admin = True
            db.session.commit()
        print("✅ Admin user verified: is_admin=True")

    print("✅ All users ready!\n")


# ---------------------------------------------------
# Main entry
# ---------------------------------------------------

with app.app_context():
    print("🔧 Creating database tables...")
    db.create_all()
    print("✅ Database tables created (including ForcedWinnerHistory)")

    print("👥 Seeding demo users...")
    seed_demo_users()

    print("🎮 Initializing game tables...")
    initialize_game_tables()

    print("▶️  Starting game threads...")
    start_all_game_tables()

    print("\n" + "=" * 60)
    print("🎮 GAME OF FIVE - Admin Panel Ready")
    print("=" * 60)
    print("📍 Admin URL: http://localhost:10000/admin")
    print("👤 Admin Username: admin")
    print("🔐 Admin Password: admin123")
    print("=" * 60)
    print(f"🔒 Super Admin Login: http://localhost:10000/sa-login")
    print(f"👤 Username: {SUPERADMIN_USERNAME}")
    print(f"🔐 Password: {SUPERADMIN_PASSWORD}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False,
        allow_unsafe_werkzeug=True,
    )
