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
from zoneinfo import ZoneInfo
from functools import wraps
from sqlalchemy import func
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

@app.after_request
def no_cache(resp):
    # Allow static files to be cached normally
    if request.path.startswith("/static"):
        return resp

    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


# ---------------------------------------------------
# Super Admin credentials (CHANGE THESE!)
# ---------------------------------------------------

SUPERADMIN_USERNAME = "superadmin"  # âœ… Change this
SUPERADMIN_PASSWORD = "SuperPass@2026"  # âœ… Change this
APP_TIMEZONE = "Asia/Kolkata"
IST = ZoneInfo("Asia/Kolkata")

def as_utc(dt: datetime) -> datetime:
    # Treat naive datetimes as UTC (your code uses datetime.utcnow() everywhere)
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def as_ist(dt: datetime) -> datetime:
    if dt is None:
        return None
    return as_utc(dt).astimezone(IST)

def fmt_ist(dt: datetime, fmt: str = "%Y-%m-%d %H:%M") -> str:
    d = as_ist(dt)
    return d.strftime(fmt) if d else ""


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
        "emoji": "ðŸ¸",
    },
    "gold": {
        "bet_amount": 50,
        "payout": 250,
        "name": "Gold Game",
        "type": "number",
        "title": "Football Goal",
        "emoji": "âš½",
    },
    "diamond": {
        "bet_amount": 100,
        "payout": 500,
        "name": "Diamond Game",
        "type": "number",
        "title": "Archer Hit",
        "emoji": "ðŸ¹",
    },
    "platinum": {
        "bet_amount": 200,
        "payout": 1000,
        "name": "Platinum Game",
        "type": "number",
        "title": "Parachute Drop",
        "emoji": "ðŸª‚",
    },
    "roulette": {
        "bet_amount": 200,
        "payout": 2000,
        "name": "Roulette Game",
        "type": "roulette",
        "title": "Roulette Spin",
        "emoji": "ðŸŽ¡",
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

    agentid = db.Column(db.Integer, db.ForeignKey('agent.id'), nullable=True, index=True)
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

class GameRoundHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    roundcode = db.Column(db.String(120), unique=True, nullable=False, index=True)
    gametype = db.Column(db.String(50), nullable=False, index=True)
    tablenumber = db.Column(db.Integer, nullable=False)
    startedat = db.Column(db.DateTime, nullable=False, index=True)
    endedat = db.Column(db.DateTime, nullable=False, index=True)
    result = db.Column(db.Integer)  # winning number
    status = db.Column(db.String(20), default="finished")
    players = db.Column(db.Integer, default=0)
    maxplayers = db.Column(db.Integer, default=0)
    totalbets = db.Column(db.Integer, default=0)
    createdat = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class GameRoundBet(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    roundcode = db.Column(db.String(120), nullable=False, index=True)
    gametype = db.Column(db.String(50), nullable=False, index=True)
    tablenumber = db.Column(db.Integer, nullable=False)
    userid = db.Column(db.String(80))  # keep string because bots are "botXYZ"
    username = db.Column(db.String(120), nullable=False, index=True)
    number = db.Column(db.Integer, nullable=False)
    betamount = db.Column(db.Integer, default=0)
    isbot = db.Column(db.Boolean, default=False)
    bettime = db.Column(db.DateTime, default=datetime.utcnow, index=True)



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

class Agent(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    passwordhash = db.Column(db.String(128), nullable=False)

    salarypercent = db.Column(db.Float, default=0.0)
    isblocked = db.Column(db.Boolean, default=False)
    blockreason = db.Column(db.Text)
    createdat = db.Column(db.DateTime, default=datetime.utcnow)

    def setpassword(self, password: str):
        self.passwordhash = hashlib.sha256(password.encode()).hexdigest()

    def checkpassword(self, password: str) -> bool:
        return self.passwordhash == hashlib.sha256(password.encode()).hexdigest()


class AgentBlockPeriod(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    agentid = db.Column(db.Integer, db.ForeignKey('agent.id'), nullable=False, index=True)
    startat = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    endat = db.Column(db.DateTime, nullable=True)  # null => still blocked



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
    # Required format: G_20260217_2200_1
    initial = (game_type or "X")[0].upper()
    stamp = as_ist(start_time).strftime("%Y%m%d_%H%M")
    return f"{initial}_{stamp}_{int(table_number)}"



# ---------------------------------------------------
# Helpers
# ---------------------------------------------------

def _get_session_user_id():
    # Compatibility (prevents name-change bugs)
    return session.get("user_id") or session.get("userid") or session.get("userId")

def _is_admin_user(user):
    return bool(
        getattr(user, "is_admin", False) or
        getattr(user, "isadmin", False) or
        getattr(user, "isAdmin", False)
    )

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        uid = _get_session_user_id()
        if not uid:
            return redirect(url_for("login_page"))

        # load user (recommended so we can block admins from game pages)
        user = User.query.get(int(uid)) if str(uid).isdigit() else User.query.get(uid)
        if not user:
            session.clear()
            return redirect(url_for("login_page"))

        # ✅ If admin is trying to access player pages, force to /admin
        if _is_admin_user(user):
            # allow admin endpoints only
            if request.path.startswith("/admin") or request.path.startswith("/api/admin") or request.path.startswith("/static") or request.path.startswith("/logout"):
                return f(*args, **kwargs)
            return redirect(url_for("admin_panel"))  # change if your admin route name differs

        return f(*args, **kwargs)
    return decorated

from functools import wraps
from flask import session, redirect, url_for

def get_session_agent_id():
    # support both new and old session keys
    return session.get('agent_id') or session.get('agentid') or session.get('agentId') or session.get('agentID')

def agent_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        aid = get_session_agent_id()
        if not aid:
            return redirect(url_for('agent_login'))  # <-- FIXED

        try:
            aid_int = int(aid)
        except Exception:
            for k in ('agent_id', 'agentid', 'agentId', 'agentID'):
                session.pop(k, None)
            return redirect(url_for('agent_login'))  # <-- FIXED

        a = Agent.query.get(aid_int)
        if not a:
            for k in ('agent_id', 'agentid', 'agentId', 'agentID'):
                session.pop(k, None)
            return redirect(url_for('agent_login'))  # <-- FIXED

        if getattr(a, 'isblocked', False):
            return "Agent is blocked. Contact admin.", 403

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


def ensure_wallet_for_user(user: User, starting_balance: int = 10000) -> Wallet:
    """Ensure wallet exists. Non-admin default = 10000."""
    if user.is_admin:
        return None
    if not user.wallet:
        wallet = Wallet(user_id=user.id, balance=int(starting_balance or 0))
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
    # NOTE: Names are kept exactly as in your original code:
    # manage_game_table, start_time, end_time, betting_close_time,
    # is_betting_closed, is_finished, game_type, table_number, round_code,
    # last_bot_added_at, max_players, bet keys: is_bot, user_id, bet_amount, date_time, etc.

    def _safe_get_bet_amount(b):
        # supports both "bet_amount" and "betamount" if your bet dict differs
        return (
            b.get("bet_amount")
            if b.get("bet_amount") is not None
            else (b.get("betamount") if b.get("betamount") is not None else None)
        )

    def _safe_get_bet_time(b):
        # supports both "bet_time" and "bettime"
        bt = b.get("bet_time")
        if bt is None:
            bt = b.get("bettime")
        return bt

    def _set_first_attr(obj, possible_names, value):
        # set the first attribute name that exists on the model
        for n in possible_names:
            try:
                if hasattr(obj, n):
                    setattr(obj, n, value)
                    return True
            except Exception:
                pass
        return False

    def _history_models_available():
        # Prevent NameError if you haven't created these models yet.
        return (
            globals().get("GameRoundHistory") is not None
            and globals().get("GameRoundBet") is not None
            and globals().get("db") is not None
        )

    def _history_exists_for_round(GameRoundHistory, round_code_value):
        # Try both common column names: round_code or roundcode
        try:
            return GameRoundHistory.query.filter_by(round_code=round_code_value).first() is not None
        except TypeError:
            pass
        try:
            return GameRoundHistory.query.filter_by(roundcode=round_code_value).first() is not None
        except TypeError:
            pass
        # Fallback: no safe way to query without knowing column name
        return False

    def _save_round_history(table, result, now_utc):
        """
        Saves a finished round + all bets into DB (GameRoundHistory + GameRoundBet).
        This function will:
        - do nothing if models are missing (no NameError)
        - avoid duplicate insert for same round_code
        - not crash the game loop if DB insert fails
        """
        if not _history_models_available():
            # Models not defined; skip saving without breaking.
            return

        GameRoundHistory = globals().get("GameRoundHistory")
        GameRoundBet = globals().get("GameRoundBet")

        try:
            # avoid duplicates
            if _history_exists_for_round(GameRoundHistory, table.round_code):
                return

            # Compute total bets
            default_bet = table.config.get("bet_amount")
            if default_bet is None:
                default_bet = table.config.get("betamount", 0)

            total_bets = 0
            for b in (table.bets or []):
                amt = _safe_get_bet_amount(b)
                if amt is None:
                    amt = default_bet or 0
                try:
                    total_bets += int(amt)
                except Exception:
                    pass

            # Create history row (set attrs safely without assuming column names)
            hist = GameRoundHistory()
            _set_first_attr(hist, ["round_code", "roundcode"], table.round_code)
            _set_first_attr(hist, ["game_type", "gametype"], table.game_type)
            _set_first_attr(hist, ["table_number", "tablenumber"], table.table_number)
            _set_first_attr(hist, ["started_at", "start_time", "startedat"], table.start_time)
            _set_first_attr(hist, ["ended_at", "end_time", "endedat"], table.end_time)
            _set_first_attr(hist, ["result", "winning_number", "winningnumber"], result)
            _set_first_attr(hist, ["status"], "finished")
            _set_first_attr(hist, ["players"], len(table.bets or []))
            _set_first_attr(hist, ["max_players", "maxplayers"], int(table.max_players or 0))
            _set_first_attr(hist, ["total_bets", "totalbets"], int(total_bets or 0))
            _set_first_attr(hist, ["created_at", "createdat"], now_utc)

            db.session.add(hist)

            # Save bets (one row per bet)
            for b in (table.bets or []):
                bet_row = GameRoundBet()

                _set_first_attr(bet_row, ["round_code", "roundcode"], table.round_code)
                _set_first_attr(bet_row, ["game_type", "gametype"], table.game_type)
                _set_first_attr(bet_row, ["table_number", "tablenumber"], table.table_number)

                _set_first_attr(bet_row, ["user_id", "userid"], str(b.get("user_id", "")))
                _set_first_attr(bet_row, ["username"], str(b.get("username", "")))

                try:
                    _set_first_attr(bet_row, ["number"], int(b.get("number", 0)))
                except Exception:
                    _set_first_attr(bet_row, ["number"], 0)

                amt = _safe_get_bet_amount(b)
                if amt is None:
                    amt = default_bet or 0
                try:
                    _set_first_attr(bet_row, ["bet_amount", "betamount"], int(amt))
                except Exception:
                    _set_first_attr(bet_row, ["bet_amount", "betamount"], 0)

                _set_first_attr(bet_row, ["is_bot", "isbot"], bool(b.get("is_bot", False)))

                bt = _safe_get_bet_time(b)
                if isinstance(bt, datetime):
                    _set_first_attr(bet_row, ["bet_time", "bettime"], bt)
                else:
                    _set_first_attr(bet_row, ["bet_time", "bettime"], now_utc)

                db.session.add(bet_row)

            db.session.commit()

        except Exception as e_hist:
            print("History save error:", e_hist)
            try:
                db.session.rollback()
            except Exception:
                pass

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

                # PRE-SELECT RESULT at <= 2 seconds remaining (for UI animation)
                if (
                    (not table.is_finished)
                    and (table.result is None)
                    and (len(table.bets) > 0)
                    and (table.get_time_remaining() <= 2)
                ):
                    forced = forced_winners.get((table.game_type, table.round_code))
                    if forced is not None:
                        bet_numbers = {b.get("number") for b in (table.bets or [])}
                        table.result = forced if forced in bet_numbers else table.calculate_result()
                    else:
                        table.result = table.calculate_result()

                    print(
                        f"{table.game_type} Table {table.table_number}: "
                        f"Pre-selected winner at <=2s: {table.result}"
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
                    print(f"{table.game_type} Table {table.table_number}: Game ended. Winner: {result}")

                    # History update (user_game_history)
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
                                rec["date_time"] = fmt_ist(now, "%Y-%m-%d %H:%M")

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

                    # Commit payouts + forced-winner history
                    db.session.commit()

                    # Save finished round + bets into DB (separate commit; won’t break game loop)
                    _save_round_history(table, result, now)

                    # clear forced winner after round ends (one-round only)
                    forced_winners.pop((table.game_type, table.round_code), None)

                    time.sleep(3)

                    # Reset for new round (predictable)
                    table.bets = []
                    table.result = None
                    table.is_betting_closed = False
                    table.is_finished = False

                    base = floor_to_period(datetime.utcnow(), ROUND_SECONDS)
                    table.start_time = base + timedelta(seconds=(table.table_number - 1) * 60)
                    table.end_time = table.start_time + timedelta(seconds=ROUND_SECONDS)
                    table.betting_close_time = table.end_time - timedelta(seconds=15)
                    table.round_code = make_round_code(table.game_type, table.start_time, table.table_number)

                    table.last_bot_added_at = None
                    print(f"{table.game_type} Table {table.table_number}: New round started - {table.round_code}")

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
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        start_hour, end_hour = map(int, time_slot.split("-"))

        slot_start = datetime.combine(target_date, datetime.min.time()).replace(hour=start_hour)
        slot_start = slot_start.replace(tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)
        slot_end = datetime.combine(target_date, datetime.min.time()).replace(hour=end_hour)
        slot_end = slot_end.replace(tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)

    except (ValueError, AttributeError):
        return jsonify({"error": "Invalid date or time_slot format"}), 400

    now = datetime.utcnow()
    cutoff_time = now + timedelta(minutes=60)  # Only show rounds >60 min away

    out = []

    for game_type in GAME_CONFIGS.keys():
        for table_number in range(1, 7):
            table_offset = (table_number - 1) * 60
            current_time = floor_to_period(slot_start, ROUND_SECONDS) + timedelta(seconds=table_offset)

            while current_time < slot_end:
                if current_time > cutoff_time:
                    minutes_until = int((current_time - now).total_seconds() / 60)
                    round_code = make_round_code(game_type, current_time, table_number)
                    forced_number = forced_winners.get((game_type, round_code))

                    out.append({
                        "game_type": game_type,
                        "game_name": GAME_CONFIGS[game_type]["name"],
                        "table_number": table_number,
                        "round_code": round_code,
                        "start_time": fmt_ist(current_time, "%Y-%m-%d %H:%M:%S"),
                        "minutes_until_start": minutes_until,
                        "forced_number": forced_number,
                        "can_force": True
                    })

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
        round_start_ist = datetime.strptime(round_start_str, "%Y%m%d_%H%M").replace(tzinfo=IST)
        round_start = round_start_ist.astimezone(timezone.utc).replace(tzinfo=None)
        
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
            history_record.note = f"Cleared at {fmt_ist(now, '%Y-%m-%d %H:%M:%S')}"
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
        existing.note = f"Updated at {fmt_ist(now, '%Y-%m-%d %H:%M:%S')}"
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
            "round_start_time": fmt_ist(h.round_start_time, "%Y-%m-%d %H:%M:%S"),
            "forced_at": fmt_ist(h.forced_at, "%Y-%m-%d %H:%M:%S"),
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
        cfg = GAME_CONFIGS[b["game_type"]]
        bet_amt = int(cfg["bet_amount"])
        payout_amt = int(cfg["payout"])

        if key not in grouped:
            grouped[key] = {
                "game_type": b["game_type"],
                "round_code": b["round_code"],
                "bet_amount": bet_amt,
                "user_bets": [],
                "winning_number": None,
                "date_time": "",
                "status": None,
                "amount": 0,          # show in UI
                "win_amount": 0,      # payout only (no subtraction)
                "loss_amount": 0,     # total bet lost (only losing picks)
                "time_remaining": None,
                "table_number": b.get("table_number"),
            }

        grouped[key]["user_bets"].append(b["number"])

        if b.get("winning_number") is not None:
            grouped[key]["winning_number"] = b["winning_number"]

            if b.get("date_time"):
                grouped[key]["date_time"] = b["date_time"]

            if b.get("status") == "win":
                grouped[key]["win_amount"] += payout_amt
            elif b.get("status") == "lose":
                grouped[key]["loss_amount"] += bet_amt

    # finalize round-level status + display amount
    for g in grouped.values():
        if g["winning_number"] is not None:
            g["status"] = "win" if g["win_amount"] > 0 else "lose"
            g["amount"] = g["win_amount"] if g["win_amount"] > 0 else g["loss_amount"]

    all_games = list(grouped.values())

    # attach time_remaining for current games
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

@app.route('/agent-login')
def agentloginpage():
    return render_template('agent-login.html')

@app.route('/agent-login', methods=['POST'])
def agentloginpost():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()

    a = Agent.query.filter_by(username=username).first()
    if not a or not a.checkpassword(password):
        return jsonify(success=False, message="Invalid credentials"), 401
    if a.isblocked:
        return jsonify(success=False, message=f"Agent blocked: {a.blockreason or 'Contact admin'}"), 403

    session['agentid'] = a.id
    session['agentId'] = a.id  # compatibility
    session['agentusername'] = a.username
    session.permanent = True
    return jsonify(success=True, redirect=url_for('agent_panel'))

@app.route('/agent/logout')
def agent_logout():
    for k in ('agent_id', 'agentid', 'agentId', 'agentID'):
        session.pop(k, None)
    return redirect('/agent/login')

@app.route('/agent')
@agent_required
def agent_panel():
    return render_template('agent_panel.html')  # <-- your HTML file

@app.route('/api/agent/profile')
@agent_required
def api_agent_profile():
    a = Agent.query.get(int(get_session_agent_id()))
    if not a:
        return jsonify(success=False, message="Agent not found"), 404

    return jsonify({
        'name': a.name,
        'username': a.username,
        'salarypercent': float(a.salarypercent or 0),
        'status': 'BLOCKED' if a.isblocked else 'ACTIVE'
    })

@app.route('/api/agent/salary')
@agent_required
def api_agent_salary():
    aid = int(get_session_agent_id())
    agent = Agent.query.get(aid)
    if not agent:
        return jsonify(success=False, message="Agent not found"), 404

    from_str = request.args.get('from')  # 'YYYY-MM-DD'
    to_str = request.args.get('to')      # 'YYYY-MM-DD'

    # users under this agent
    users = User.query.filter_by(agentid=aid).all()
    user_ids = [u.id for u in users]

    base_query = db.session.query(Transaction).filter(
        Transaction.user_id.in_(user_ids),
        func.lower(Transaction.kind) == 'bet'
    )

    if from_str:
        try:
            dt_from = datetime.strptime(from_str, "%Y-%m-%d")
            base_query = base_query.filter(Transaction.datetime >= dt_from)
        except ValueError:
            pass

    if to_str:
        try:
            dt_to = datetime.strptime(to_str, "%Y-%m-%d") + timedelta(days=1)
            base_query = base_query.filter(Transaction.datetime < dt_to)
        except ValueError:
            pass

    # total played in range
    total_played = (base_query.with_entities(func.coalesce(func.sum(Transaction.amount), 0)).scalar()) or 0
    total_salary = (float(total_played) * float(agent.salarypercent or 0)) / 100.0

    # per-user breakdown
    items = []
    for u in users:
        q_u = base_query.filter(Transaction.user_id == u.id)
        amount_played = (q_u.with_entities(func.coalesce(func.sum(Transaction.amount), 0)).scalar()) or 0
        salary_generated = (amount_played * float(agent.salarypercent or 0)) / 100.0

        items.append({
            "userid": u.id,
            "joining": fmt_ist(u.created_at, "%Y-%m-%d %H:%M") if u.created_at else "",
            "amountplayed": int(amount_played),
            "salarygenerated": round(salary_generated, 0),
        })

    return jsonify({
        "totalplayed": int(total_played),
        "totalsalary": round(total_salary, 0),
        "items": items,
    })



@app.route('/api/agent/users', methods=['GET', 'POST'])
@agent_required
def api_agent_users():
    aid = int(get_session_agent_id())
    agent = Agent.query.get(aid)
    if not agent:
        return jsonify(success=False, message="Agent not found"), 404

    if request.method == 'POST':
        data = request.get_json() or {}
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        display_name = (data.get('displayname') or '').strip()
        phone = (data.get('phone') or '').strip()
        email = (data.get('email') or '').strip()
        country = (data.get('country') or '').strip()

        if not username or not password:
            return jsonify(success=False, message="Username and password required"), 400

        if User.query.filter_by(username=username).first():
            return jsonify(success=False, message="Username already exists"), 400

        u = User(username=username, agentid=aid, is_admin=False, is_blocked=False)
        u.set_password(password)
        if display_name:
            u.display_name = display_name
        if phone:
            u.phone = phone
        if email:
            u.email = email
        if country:
            u.country = country

        db.session.add(u)
        db.session.commit()

        ensure_wallet_for_user(u, starting_balance=0)   # starts with 10000 for non-admin

        return jsonify(success=True, message="User created", userid=u.id)

    # GET: list users under agent with stats
    users = User.query.filter_by(agentid=aid).order_by(User.created_at.desc()).all()
    user_ids = [u.id for u in users]

    played_map = {}
    if user_ids:
        rows = (
            db.session.query(Transaction.user_id, func.coalesce(func.sum(Transaction.amount), 0))
            .filter(
                Transaction.user_id.in_(user_ids),
                func.lower(Transaction.kind) == 'bet'
            )
            .group_by(Transaction.user_id)
            .all()
        )
        played_map = {uid: int(total or 0) for uid, total in rows}

    out = []
    for u in users:
        amount_played = played_map.get(u.id, 0)
        salary_generated = (amount_played * float(agent.salarypercent or 0)) / 100.0

        out.append({
            "userid": u.id,
            "username": u.username,
            "status": "blocked" if u.is_blocked else "active",
            "joining": fmt_ist(u.created_at, "%Y-%m-%d %H:%M") if u.created_at else "",
            "amountplayed": int(amount_played),
            "salarygenerated": round(salary_generated, 0),
        })

    return jsonify(out)

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
                    "created_at": fmt_ist(t.created_at, "%Y-%m-%d %H:%M"),
                    "updated_at": fmt_ist(t.updated_at, "%Y-%m-%d %H:%M"),
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


def _get_user_history_store():
    # supports both variable names used across your versions
    return globals().get("user_game_history") or globals().get("usergamehistory") or {}

def _get_game_tables_store():
    return globals().get("game_tables") or globals().get("gametables") or {}

def _fmt_ist(dt, fmt="%Y-%m-%d %H:%M"):
    f = globals().get("fmt_ist") or globals().get("fmtist")
    return f(dt, fmt) if f else (dt.strftime(fmt) if dt else "")

def _ensure_wallet(user):
    fn = globals().get("ensure_wallet_for_user") or globals().get("ensurewalletforuser")
    return fn(user) if fn else None

def _create_wallet_for_user(userid: int, starting_balance: int = 0):
    w = Wallet.query.filter_by(userid=userid).first()
    if w:
        return w
    w = Wallet(userid=userid, balance=int(starting_balance or 0))
    db.session.add(w)
    db.session.commit()
    return w


def _is_admin_user(user):
    return bool(getattr(user, "is_admin", False) or getattr(user, "isadmin", False) or getattr(user, "isAdmin", False))

def _is_blocked_user(user):
    return bool(getattr(user, "is_blocked", False) or getattr(user, "isblocked", False) or getattr(user, "isBlocked", False))

def _get_block_reason(user):
    return (getattr(user, "block_reason", None)
            or getattr(user, "blockreason", None)
            or getattr(user, "blockReason", None)
            or "")

def _set_block_reason(user, val):
    if hasattr(user, "block_reason"):
        user.block_reason = val
    elif hasattr(user, "blockreason"):
        user.blockreason = val
    else:
        # last fallback
        setattr(user, "block_reason", val)

def _set_blocked(user, is_blocked: bool):
    if hasattr(user, "is_blocked"):
        user.is_blocked = bool(is_blocked)
    elif hasattr(user, "isblocked"):
        user.isblocked = bool(is_blocked)
    else:
        setattr(user, "is_blocked", bool(is_blocked))

def _get_created_at(user):
    return getattr(user, "created_at", None) or getattr(user, "createdat", None) or getattr(user, "createdAt", None)

def _parse_round_start_from_roundcode(roundcode: str):
    """
    roundcode format used in your project: Initial + YYYYMMDD + HHMM + TableNo
    Example: G2026021722001 -> '202602172200' is IST time.
    Returns timezone-aware IST datetime if IST/global exists, else naive dt.
    """
    try:
        s = str(roundcode or "")
        if len(s) < 13:
            return None
        dt = datetime.strptime(s[1:13], "%Y%m%d%H%M")
        ist = globals().get("IST", None)
        return dt.replace(tzinfo=ist) if ist else dt
    except Exception:
        return None

def _group_user_rounds(user_id: int):
    """
    Groups user bet history into per-round rows.
    Uses in-memory store (user_game_history/usergamehistory).
    """
    store = _get_user_history_store()
    bets = store.get(user_id, []) or []

    grouped = {}  # key=(gametype, roundcode, tablenumber) -> row

    for b in bets:
        gametype = b.get("gametype") or b.get("game_type") or b.get("gameType") or "-"
        roundcode = b.get("roundcode") or b.get("round_code") or b.get("roundCode") or "-"
        tablenumber = b.get("tablenumber") or b.get("table_number") or b.get("tableNumber") or 0

        key = (gametype, roundcode, tablenumber)
        if key not in grouped:
            start_dt = _parse_round_start_from_roundcode(roundcode)
            grouped[key] = {
                "roundid": roundcode,
                "roundcode": roundcode,
                "gametype": gametype,
                "game_type": gametype,

                "tablenumber": tablenumber,
                "table_number": tablenumber,

                "bettingnumbers": [],
                "numbers": [],

                "totalbet": 0,
                "winningnumber": None,
                "winning_number": None,

                "netamount": 0,          # winning/losing amount (net)
                "result": "pending",

                "datetime": _fmt_ist(start_dt, "%Y-%m-%d %H:%M") if start_dt else "",
                "date_time": _fmt_ist(start_dt, "%Y-%m-%d %H:%M") if start_dt else "",
            }

        # numbers
        num = b.get("number")
        if num is not None:
            grouped[key]["bettingnumbers"].append(num)
            grouped[key]["numbers"].append(num)

        # total bet
        bet_amt = b.get("betamount") or b.get("bet_amount") or 0
        try:
            grouped[key]["totalbet"] += int(bet_amt)
        except Exception:
            pass

        # winning number
        wn = b.get("winningnumber")
        if wn is None:
            wn = b.get("winning_number")
        if wn is not None:
            grouped[key]["winningnumber"] = wn
            grouped[key]["winning_number"] = wn

        # net amount (your history uses +payout for win, -betamount for loss) [file:106]
        amt = b.get("amount", 0)
        try:
            grouped[key]["netamount"] += int(amt or 0)
        except Exception:
            pass

    # finalize each grouped row
    out = []
    for row in grouped.values():
        # unique/sorted numbers
        nums = []
        for n in row["bettingnumbers"]:
            try:
                nums.append(int(n))
            except Exception:
                continue
        nums = sorted(set(nums))
        row["bettingnumbers"] = nums
        row["numbers"] = nums

        # result
        if row["winningnumber"] is None:
            row["result"] = "pending"
        else:
            row["result"] = "win" if row["netamount"] > 0 else "lose"

        out.append(row)

    # newest first (by datetime text)
    out.sort(key=lambda x: x.get("datetime") or "", reverse=True)
    return out


# -----------------------------
# Admin APIs (REPLACE your current ones with these)
# -----------------------------
# ---- Admin page route (must exist, otherwise /admin = 404) ----

@app.route("/admin")
@admin_required
def admin_panel():
    return render_template("admin_panel.html")

@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_get_users():
    # supports both model styles: is_admin OR isadmin [file:106]
    users = User.query.all()
    users = [u for u in users if not _is_admin_user(u)]

    user_list = []
    for user in users:
        wallet = _ensure_wallet(user)
        created_at = _get_created_at(user)
        joining = _fmt_ist(created_at, "%Y-%m-%d %H:%M") if created_at else ""

        rounds = _group_user_rounds(user.id)
        total_games = len(rounds)

        # "Winning Amount" = total amount WON (sum of positive net entries)
        # (Net profit would be sum(netamount), but you asked winning amount column.)
        winning_amount = 0
        store = _get_user_history_store()
        for rec in (store.get(user.id, []) or []):
            try:
                a = int(rec.get("amount") or 0)
                if a > 0:
                    winning_amount += a
            except Exception:
                pass

        user_list.append({
            "id": user.id,
            "username": getattr(user, "username", "") or "",

            "status": "blocked" if _is_blocked_user(user) else "active",
            "total_games": int(total_games),
            "gamesplayed": int(total_games),           # keeps old frontend mapping working [file:105]
            "winning_amount": int(winning_amount),
            "balance": int(getattr(wallet, "balance", 0) if wallet else 0),

            "joining": joining,
            "created_at": joining,                     # compatibility for older UI [file:105]
            "createdat": joining,                      # compatibility for older UI [file:105]

            # fields for Edit modal
            "email": getattr(user, "email", "") or "",
            "country": getattr(user, "country", "") or "",
            "phone": getattr(user, "phone", "") or "",
            "block_reason": _get_block_reason(user),
            "blockreason": _get_block_reason(user),
        })

    return jsonify(user_list)


@app.route("/api/admin/users/<int:user_id>", methods=["PUT"])
@admin_required
def admin_update_user(user_id):
    user = User.query.get(user_id)
    if not user or _is_admin_user(user):
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}

    # Keep username editable only if you truly want it; otherwise comment this out
    if "username" in data and data["username"]:
        user.username = str(data["username"]).strip()

    if "email" in data:
        user.email = (data.get("email") or "").strip()

    if ("password" in data) and data.get("password"):
        user.set_password(data["password"])

    # status may come as "active"/"blocked"
    if "status" in data:
        _set_blocked(user, str(data.get("status", "")).lower() == "blocked")

    # accept both block_reason and blockReason
    if "block_reason" in data or "blockReason" in data:
        _set_block_reason(user, (data.get("block_reason") or data.get("blockReason") or "").strip())

    # NOTE: Do not update wallet balance here; use /balance endpoint only.
    db.session.commit()
    return jsonify({"success": True, "message": "User updated successfully"})


@app.route("/api/admin/users/<int:user_id>/block", methods=["POST"])
@admin_required
def admin_block_user(user_id):
    user = User.query.get(user_id)
    if not user or _is_admin_user(user):
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    _set_blocked(user, True)
    _set_block_reason(user, data.get("reason", "Blocked by admin"))
    db.session.commit()
    return jsonify({"success": True, "message": "User blocked successfully"})


@app.route("/api/admin/users/<int:user_id>/unblock", methods=["POST"])
@admin_required
def admin_unblock_user(user_id):
    user = User.query.get(user_id)
    if not user or _is_admin_user(user):
        return jsonify({"success": False, "message": "User not found"}), 404

    _set_blocked(user, False)
    _set_block_reason(user, "")
    db.session.commit()
    return jsonify({"success": True, "message": "User unblocked successfully"})


@app.route("/api/admin/users/<int:user_id>/balance", methods=["POST"])
@admin_required
def admin_credit_debit(user_id):
    user = User.query.get(user_id)
    if not user or _is_admin_user(user):
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.get_json() or {}
    transaction_type = (data.get("type") or "add").lower()
    amount = float(data.get("amount") or 0)
    reason = data.get("reason", "Admin transaction")

    wallet = _ensure_wallet(user)
    if not wallet:
        return jsonify({"success": False, "message": "Wallet not found"}), 404

    if amount < 0:
        amount = abs(amount)

    if transaction_type == "add":
        wallet.balance = int(wallet.balance + amount)
    else:
        wallet.balance = int(wallet.balance - amount)
        if wallet.balance < 0:
            wallet.balance = 0

    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Transaction processed. New balance: {wallet.balance}",
        "new_balance": wallet.balance,
        "reason": reason,
    })


@app.route("/api/admin/games", methods=["GET"])
@admin_required
def admin_get_games():
    tables_store = _get_game_tables_store()
    all_games = []

    for gametype, tables in (tables_store or {}).items():
        for table in (tables or []):
            # supports your GameTable attributes: roundcode/starttime/isfinished/isbettingclosed/maxplayers [file:106]
            roundcode = getattr(table, "round_code", None) or getattr(table, "roundcode", None) or "-"
            starttime = getattr(table, "start_time", None) or getattr(table, "starttime", None)

            bets = getattr(table, "bets", []) or []
            def _bet_amt(b):
                if isinstance(b, dict):
                    return b.get("bet_amount", 0) or b.get("betamount", 0) or 0
                return getattr(b, "bet_amount", 0) or getattr(b, "betamount", 0) or 0

            all_games.append({
                "roundcode": roundcode,
                "round_code": roundcode,  # compatibility
                "gametype": gametype,
                "game_type": gametype,

                "players": len(bets),
                "maxplayers": getattr(table, "max_players", None) or getattr(table, "maxplayers", None) or 0,

                "status": (
                    "finished" if (getattr(table, "is_finished", False) or getattr(table, "isfinished", False))
                    else "completed" if (getattr(table, "is_betting_closed", False) or getattr(table, "isbettingclosed", False))
                    else "active"
                ),
                "result": getattr(table, "result", None),
                "totalbets": int(sum(_bet_amt(b) for b in bets)),
                "total_bets": int(sum(_bet_amt(b) for b in bets)),
                "startedat": _fmt_ist(starttime, "%Y-%m-%d %H:%M") if starttime else "",
                "started_at": _fmt_ist(starttime, "%Y-%m-%d %H:%M") if starttime else "",
            })

    return jsonify(all_games)

from sqlalchemy import or_

def _pick_col(Model, *names):
    for n in names:
        if hasattr(Model, n):
            return getattr(Model, n)
    raise AttributeError(f"{Model.__name__} missing columns: {names}")

def _pick_val(obj, *names):
    for n in names:
        if hasattr(obj, n):
            return getattr(obj, n)
    return None

def _fmt_ist_safe(dt, fmt="%Y-%m-%d %H:%M"):
    f = globals().get("fmt_ist") or globals().get("fmtist")
    return f(dt, fmt) if (f and dt) else ("-" if not dt else dt.strftime(fmt))

@app.route("/api/admin/games/history", methods=["GET"])
@admin_required  # keep whatever decorator name your current file uses
def admingameshistory():
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 100))
    q = (request.args.get("q") or "").strip().lower()

    ROUND = _pick_col(GameRoundHistory, "round_code", "roundcode")
    TYPE  = _pick_col(GameRoundHistory, "game_type", "gametype")
    START = _pick_col(GameRoundHistory, "started_at", "startedat")
    END   = _pick_col(GameRoundHistory, "ended_at", "endedat")

    query = GameRoundHistory.query
    if q:
        query = query.filter(
            or_(
                db.func.lower(ROUND).like(f"%{q}%"),
                db.func.lower(TYPE).like(f"%{q}%")
            )
        )

    total = query.count()
    rows = (query.order_by(END.desc())
                 .offset((page - 1) * limit)
                 .limit(limit)
                 .all())

    items = []
    for r in rows:
        items.append({
            "roundcode": _pick_val(r, "round_code", "roundcode"),
            "gametype": _pick_val(r, "game_type", "gametype"),
            "players": _pick_val(r, "players") or 0,
            "maxplayers": _pick_val(r, "max_players", "maxplayers") or 0,
            "result": _pick_val(r, "result"),
            "totalbets": _pick_val(r, "total_bets", "totalbets") or 0,
            "startedat": _fmt_ist_safe(_pick_val(r, "started_at", "startedat")),
            "status": _pick_val(r, "status") or "finished",
        })

    return jsonify(items=items, page=page, limit=limit, total=total)


@app.route("/api/admin/games/<path:roundcode>/user-bets", methods=["GET"])
@admin_required  # keep your current decorator
def admingameuserbets(roundcode):
    include_bots = (request.args.get("includeBots", "0") == "1")

    def norm(s: str) -> str:
        return (s or "").replace("_", "").strip().lower()

    target = norm(roundcode)

    tables_store = globals().get("game_tables") or globals().get("gametables") or {}
    for gametype, tables in (tables_store or {}).items():
        for t in (tables or []):
            rc = getattr(t, "roundcode", None) or getattr(t, "round_code", None) or ""
            if norm(rc) != target:
                continue

            grouped = {}
            for b in (getattr(t, "bets", None) or []):
                if not isinstance(b, dict):
                    continue
                is_bot = b.get("isbot")
                if is_bot is None:
                    is_bot = b.get("is_bot", False)

                if (not include_bots) and is_bot:
                    continue

                uname = str(b.get("username", ""))
                num = b.get("number", None)
                if num is None:
                    continue
                grouped.setdefault(uname, set()).add(int(num))

            users = [{"username": u, "numbers": sorted(list(ns))} for u, ns in grouped.items()]
            users.sort(key=lambda x: x["username"].lower())
            return jsonify(roundcode=roundcode, users=users)

    return jsonify(roundcode=roundcode, users=[])


@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_get_stats():
    users = User.query.all()
    users = [u for u in users if not _is_admin_user(u)]

    total_users = len(users)
    blocked_users = sum(1 for u in users if _is_blocked_user(u))

    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    store = _get_user_history_store()

    active_users = 0
    for u in users:
        recent = False
        for g in (store.get(u.id, []) or []):
            bt = g.get("bettime") or g.get("bet_time")
            if isinstance(bt, datetime) and bt > thirty_days_ago:
                recent = True
                break
        if recent:
            active_users += 1

    inactive_users = total_users - active_users

    total_revenue = sum((w.balance or 0) for w in Wallet.query.all())
    total_deposit = total_revenue
    total_withdrawal = 0

    tables_store = _get_game_tables_store()
    active_games = sum(
        1
        for tables in (tables_store or {}).values()
        for t in (tables or [])
        if not (getattr(t, "is_finished", False) or getattr(t, "isfinished", False))
    )

    open_tickets = Ticket.query.filter_by(status="open").count()

    return jsonify({
        "total_users": total_users,
        "active_users": active_users,
        "inactive_users": inactive_users,
        "active_games": active_games,
        "total_revenue": total_revenue,
        "total_deposit": total_deposit,
        "total_withdrawal": total_withdrawal,
        "blocked_users": blocked_users,
        "open_tickets": open_tickets,
    })


@app.route("/api/admin/users/<int:user_id>/games", methods=["GET"])
@admin_required
def admin_user_games(user_id):
    # ONE ROW PER ROUND (your requirement)
    return jsonify(_group_user_rounds(user_id))


from datetime import datetime
from sqlalchemy import func
from flask import request, jsonify

# ----------------------------
# Agents: List + Create
# ----------------------------


@app.route('/api/admin/agents', methods=['GET', 'POST'])
@admin_required
def adminagents():
    if request.method == 'POST':
        data = request.get_json() or {}

        name = (data.get('name') or data.get('agentName') or '').strip()
        username = (data.get('username') or data.get('agentUsername') or '').strip()
        password = (data.get('password') or data.get('agentPassword') or '').strip()

        sp = data.get('salarypercent')
        if sp is None:
            sp = data.get('salaryPercent')
        if sp is None:
            sp = data.get('agentSalaryPercent')

        try:
            salarypercent = float(sp or 0)
        except Exception:
            salarypercent = 0

        if not name or not username or not password:
            return jsonify(success=False, message="name, username, password required"), 400
        if salarypercent < 0 or salarypercent > 100:
            return jsonify(success=False, message="salarypercent must be 0-100"), 400
        if Agent.query.filter_by(username=username).first():
            return jsonify(success=False, message="Agent username already exists"), 400

        a = Agent(name=name, username=username, salarypercent=salarypercent)
        a.setpassword(password)
        db.session.add(a)
        db.session.commit()
        return jsonify(success=True, message="Agent created", id=a.id)

    # GET: list agents + computed totals
    agents = Agent.query.order_by(Agent.createdat.desc()).all()
    out = []

    for a in agents:
        # Get user ids under this agent (User.agentid must exist)
        rows = User.query.with_entities(User.id).filter_by(agentid=a.id).all()
        user_ids = [r[0] for r in rows]
        usercount = len(user_ids)

        totalplayed = 0
        if user_ids:
            totalplayed = (
                db.session.query(func.coalesce(func.sum(Transaction.amount), 0))
                .filter(Transaction.user_id.in_(user_ids))
                .filter(func.lower(Transaction.kind) == 'bet')
                .scalar()
            ) or 0

        totalsalary = (float(totalplayed) * float(a.salarypercent or 0)) / 100.0

        out.append({
            "id": a.id,
            "name": a.name,
            "username": a.username,
            "salarypercent": float(a.salarypercent or 0),
            "isblocked": bool(a.isblocked),
            "blockreason": a.blockreason or "",
            "usercount": usercount,
            "totalplayed": int(totalplayed),
            "totalsalary": round(totalsalary, 2),
            "createdat": fmt_ist(a.createdat, "%Y-%m-%d %H:%M") if a.createdat else ""
        })

    return jsonify(out)


# ----------------------------
# Agents: Update (Edit button)
# ----------------------------
@app.route('/api/admin/agents/<int:agentid>', methods=['PUT'])
@admin_required
def adminupdateagent(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify(success=False, message="Agent not found"), 404

    data = request.get_json() or {}

    # allow editing name + salary%
    if 'name' in data or 'agentName' in data:
        a.name = (data.get('name') or data.get('agentName') or a.name).strip()

    sp = data.get('salarypercent')
    if sp is None:
        sp = data.get('salaryPercent')
    if sp is not None:
        try:
            sp = float(sp)
        except Exception:
            return jsonify(success=False, message="salarypercent must be a number"), 400
        if sp < 0 or sp > 100:
            return jsonify(success=False, message="salarypercent must be 0-100"), 400
        a.salarypercent = sp

    db.session.commit()
    return jsonify(success=True, message="Agent updated")


# ----------------------------
# Agents: Block / Unblock
# ----------------------------
@app.route('/api/admin/agents/<int:agentid>/block', methods=['POST'])
@admin_required
def adminblockagent(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify(success=False, message="Agent not found"), 404

    data = request.get_json() or {}
    reason = (data.get('reason') or 'Blocked by admin').strip()

    if not a.isblocked:
        a.isblocked = True
        a.blockreason = reason
        db.session.add(AgentBlockPeriod(agentid=a.id, startat=datetime.utcnow(), endat=None))
        db.session.commit()

    return jsonify(success=True, message="Agent blocked")


@app.route('/api/admin/agents/<int:agentid>/unblock', methods=['POST'])
@admin_required
def adminunblockagent(agentid):
    a = Agent.query.get(agentid)
    if not a:
        return jsonify(success=False, message="Agent not found"), 404

    if a.isblocked:
        a.isblocked = False
        a.blockreason = None

        openp = (AgentBlockPeriod.query
                 .filter_by(agentid=a.id, endat=None)
                 .order_by(AgentBlockPeriod.startat.desc())
                 .first())
        if openp:
            openp.endat = datetime.utcnow()

        db.session.commit()

    return jsonify(success=True, message="Agent unblocked")


# ----------------------------
# Agents: Users list (click Users count)
# ----------------------------
from sqlalchemy import func

from sqlalchemy import func

@app.route('/api/admin/agents/<int:agentid>/users', methods=['GET'])
@admin_required
def admin_agent_users(agentid):
    try:
        a = Agent.query.get(agentid)
        if not a:
            return jsonify(success=False, message="Agent not found"), 404

        # Find which "created" column exists on User model
        created_col = None
        for colname in ("createdat", "createdAt", "created_at"):
            if hasattr(User, colname):
                created_col = getattr(User, colname)
                break

        q = User.query.filter_by(agentid=a.id)
        if created_col is not None:
            q = q.order_by(created_col.asc())
        else:
            q = q.order_by(User.id.asc())

        users = q.all()
        user_ids = [int(u.id) for u in users]

        played_map = {}
        if user_ids:
            rows = (
                db.session.query(Transaction.userid, func.coalesce(func.sum(Transaction.amount), 0))
                .filter(Transaction.user_id.in_(user_ids))
                .filter(func.lower(Transaction.kind) == 'bet')
                .group_by(Transaction.user_id)
                .all()
            )
            played_map = {int(uid): int(total or 0) for uid, total in rows}

        items = []
        for u in users:
            # Read created date safely
            u_created = (
                getattr(u, "createdat", None)
                or getattr(u, "createdAt", None)
                or getattr(u, "created_at", None)
            )

            amount_played = played_map.get(int(u.id), 0)
            salary_generated = (amount_played * float(a.salarypercent or 0)) / 100.0

            items.append({
                "userid": u.id,
                "joining": fmt_ist(u_created, "%Y-%m-%d %H:%M") if u_created else "",
                "amountplayed": int(amount_played),
                "salarygenerated": round(salary_generated, 2)
            })

        return jsonify({"agentid": a.id, "items": items})

    except Exception as e:
        return jsonify(success=False, message=f"agent users api error: {str(e)}"), 500




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
    users = [u for u in User.query.all() if not _is_admin_user(u)]
    total_users = len(users)
    total_wallets = Wallet.query.count()
    total_balance = db.session.query(db.func.sum(Wallet.balance)).scalar() or 0
    return jsonify({
        "total_users": total_users,
        "total_wallets": total_wallets,
        "total_balance": total_balance,
        "top_games": [],
        "top_users": [],
    })


@app.route("/api/admin/transactions", methods=["GET"])
@admin_required
def admin_get_transactions():
    # Keep this compatible with your current admin_panel.html expectations:
    # it builds txns from user history and emits BET + WIN records. [file:106][file:105]
    store = _get_user_history_store()
    out = []

    for uid, bets in store.items():
        user = User.query.get(uid)
        username = getattr(user, "username", None) if user else f"user_{uid}"

        for rec in (bets or []):
            gametype = rec.get("gametype") or rec.get("game_type") or "-"
            roundcode = rec.get("roundcode") or rec.get("round_code") or "-"

            cfg = (globals().get("GAME_CONFIGS") or globals().get("GAMECONFIGS") or {}).get(gametype, {})
            game_title = cfg.get("name") or cfg.get("name", gametype)

            bet_amt = rec.get("betamount") or rec.get("bet_amount") or cfg.get("bet_amount") or cfg.get("betamount") or 0
            bt = rec.get("bettime") or rec.get("bet_time") or datetime.utcnow()
            dt_str = _fmt_ist(bt, "%Y-%m-%d %H:%M") if isinstance(bt, datetime) else str(bt)

            out.append({
                "userid": uid,
                "user_id": uid,
                "username": username,
                "type": "BET",
                "gametype": gametype,
                "game_type": gametype,
                "gametitle": game_title,
                "game_title": game_title,
                "roundcode": roundcode,
                "round_code": roundcode,
                "amount": int(bet_amt or 0),
                "status": (rec.get("status") or "PENDING").upper(),
                "datetime": dt_str,
            })

            # win record if resolved+win
            is_resolved = bool(rec.get("isresolved", False) or rec.get("is_resolved", False))
            is_win = bool(rec.get("win", False)) or (str(rec.get("status", "")).lower() == "win")
            if is_resolved and is_win:
                win_dt = rec.get("datetime") or rec.get("date_time") or dt_str
                payout = cfg.get("payout") or cfg.get("payout", 0)

                out.append({
                    "userid": uid,
                    "user_id": uid,
                    "username": username,
                    "type": "WIN",
                    "gametype": gametype,
                    "game_type": gametype,
                    "gametitle": game_title,
                    "game_title": game_title,
                    "roundcode": roundcode,
                    "round_code": roundcode,
                    "amount": int(payout or 0),
                    "status": "WIN",
                    "datetime": win_dt,
                })

    return jsonify(out)

from flask import render_template, request, redirect, url_for, session
from sqlalchemy import func
from sqlalchemy.inspection import inspect as sa_inspect

def _agent_column_keys():
    try:
        return [c.key for c in sa_inspect(Agent).mapper.column_attrs]
    except Exception:
        return []

def _pick_key(keys, preferred):
    for k in preferred:
        if k in keys:
            return k
    return None

def _safe_str(x):
    if x is None:
        return ""
    if isinstance(x, (bytes, bytearray)):
        try:
            return x.decode("utf-8", "ignore")
        except Exception:
            return str(x)
    return str(x)

from flask import render_template, request, redirect, url_for, session
from sqlalchemy import func

@app.route('/agent/login', methods=['GET', 'POST'])
def agent_login():
    # already logged in
    if session.get('agent_id') or session.get('agentid') or session.get('agentId') or session.get('agentID'):
        return redirect(url_for('agent_panel'))

    error = None

    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        password = (request.form.get('password') or '').strip()

        if not username or not password:
            return render_template('agent_login.html', error="Username and password required.")

        agent = Agent.query.filter(func.lower(Agent.username) == username.lower()).first()
        if not agent:
            return render_template('agent_login.html', error="Invalid credentials.")

        if agent.isblocked:
            return render_template('agent_login.html', error="Your account is blocked. Contact admin.")

        # IMPORTANT: your model uses SHA-256 passwordhash
        if not agent.checkpassword(password):
            return render_template('agent_login.html', error="Invalid credentials.")

        # success: set session (support both new and your decorator key)
        session['agent_id'] = int(agent.id)
        session['agentid'] = int(agent.id)
        session.pop('agentId', None)
        session.pop('agentID', None)

        return redirect(url_for('agent_panel'))

    return render_template('agent_login.html', error=error)

@app.route('/api/agent/profile/password', methods=['PUT'])
@agent_required
def api_agent_change_password():
    a = Agent.query.get(int(get_session_agent_id()))
    if not a:
        return jsonify(success=False, message="Agent not found"), 404

    data = request.get_json(silent=True) or {}
    password = (data.get('password') or '').strip()
    if not password:
        return jsonify(success=False, message="Password required"), 400

    a.setpassword(password)   # <-- IMPORTANT (sha256 -> passwordhash)
    db.session.commit()
    return jsonify(success=True, message="Password updated")

@app.route('/api/agent/stats')
@agent_required
def api_agent_stats():
    aid = int(get_session_agent_id())
    agent = Agent.query.get(aid)
    if not agent:
        return jsonify(success=False, message="Agent not found"), 404

    # users under this agent
    user_ids = [u.id for u in User.query.with_entities(User.id).filter_by(agentid=aid).all()]
    total_users = len(user_ids)

    total_played = 0
    if user_ids:
        total_played = (
            db.session.query(func.coalesce(func.sum(Transaction.amount), 0))
            .filter(
                Transaction.user_id.in_(user_ids),
                func.lower(Transaction.kind) == 'bet'
            )
            .scalar()
        ) or 0

    total_salary = (float(total_played) * float(agent.salarypercent or 0)) / 100.0

    return jsonify(
        totalusers=total_users,
        totalsalary=round(total_salary, 0),
    )



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

    print(f"ðŸŽ¯ Bet attempt: user={raw_user_id}, game={game_type}, number={number}, round={round_code}")

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

    # âœ… CRITICAL: Add bet to table (forced winners don't interfere here)
    success, message = table.add_bet(user_id, username, number)
    if not success:
        print(f"âŒ Bet rejected: {message}")
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

    print(f"âœ… Bet placed successfully: user={user_id}, number={number}, round={table.round_code}")

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
    print("\nðŸ”„ Checking/Creating users...")

    demo_usernames = ["demo"] + [f"demo{i}" for i in range(1, 6)]
    for uname in demo_usernames:
        user = User.query.filter_by(username=uname).first()
        if not user:
            user = User(username=uname, display_name=uname)
            user.set_password("demo123")
            db.session.add(user)
            db.session.commit()
            print(f"âœ… Created user: {uname}")
        ensure_wallet_for_user(user)

    admin = User.query.filter_by(username="admin").first()
    if not admin:
        print("âœ… Creating admin user...")
        admin = User(username="admin", display_name="Admin User", is_admin=True)
        admin.set_password("admin123")
        db.session.add(admin)
        db.session.commit()
        print("âœ… Admin user created: is_admin=True (NO WALLET)")
    else:
        if not admin.is_admin:
            print("âš ï¸  Fixing admin user: setting is_admin=True")
            admin.is_admin = True
            db.session.commit()
        print("âœ… Admin user verified: is_admin=True")

    print("âœ… All users ready!\n")


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
